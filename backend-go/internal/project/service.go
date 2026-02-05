package project

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/inamate/inamate/backend-go/internal/db/dbgen"
	"github.com/inamate/inamate/backend-go/internal/document"
	"github.com/inamate/inamate/backend-go/internal/typeid"
)

var (
	ErrNotFound  = errors.New("project not found")
	ErrForbidden = errors.New("forbidden")
	ErrNotMember = errors.New("not a project member")
)

type Service struct {
	queries *dbgen.Queries
}

func NewService(queries *dbgen.Queries) *Service {
	return &Service{queries: queries}
}

type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	OwnerID   string `json:"ownerId"`
	FPS       int    `json:"fps"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Member struct {
	UserID      string `json:"userId"`
	Role        string `json:"role"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
}

func (s *Service) Create(ctx context.Context, name, ownerID string) (*Project, error) {
	projectID := typeid.NewProjectID()

	dbProj, err := s.queries.CreateProject(ctx, dbgen.CreateProjectParams{
		ID:      projectID,
		Name:    name,
		OwnerID: ownerID,
	})
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}

	// Add owner as member
	err = s.queries.AddProjectMember(ctx, dbgen.AddProjectMemberParams{
		ProjectID: projectID,
		UserID:    ownerID,
		Role:      dbgen.ProjectRoleOwner,
	})
	if err != nil {
		return nil, fmt.Errorf("add owner as member: %w", err)
	}

	// Seed empty document snapshot
	sceneID := typeid.NewSceneID()
	rootID := typeid.NewObjectID()
	timelineID := typeid.NewTimelineID()
	emptyDoc := document.NewEmptyDocument(projectID, name, sceneID, rootID, timelineID)
	docJSON, err := json.Marshal(emptyDoc)
	if err != nil {
		return nil, fmt.Errorf("marshal empty document: %w", err)
	}

	_, err = s.queries.CreateSnapshot(ctx, dbgen.CreateSnapshotParams{
		ID:        typeid.NewSnapshotID(),
		ProjectID: projectID,
		Version:   1,
		Document:  docJSON,
	})
	if err != nil {
		return nil, fmt.Errorf("create initial snapshot: %w", err)
	}

	return dbProjectToProject(dbProj), nil
}

func (s *Service) Get(ctx context.Context, projectID, userID string) (*Project, error) {
	if err := s.checkMembership(ctx, projectID, userID); err != nil {
		return nil, err
	}

	dbProj, err := s.queries.GetProject(ctx, projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get project: %w", err)
	}

	return dbProjectToProject(dbProj), nil
}

func (s *Service) List(ctx context.Context, userID string) ([]Project, error) {
	dbProjects, err := s.queries.ListProjectsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}

	projects := make([]Project, len(dbProjects))
	for i, p := range dbProjects {
		projects[i] = *dbProjectToProject(p)
	}

	return projects, nil
}

func (s *Service) Delete(ctx context.Context, projectID, userID string) error {
	dbProj, err := s.queries.GetProject(ctx, projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get project: %w", err)
	}

	if dbProj.OwnerID != userID {
		return ErrForbidden
	}

	return s.queries.DeleteProject(ctx, projectID)
}

func (s *Service) InviteByEmail(ctx context.Context, projectID, ownerID, inviteeEmail string) error {
	// Verify the requester is the owner
	dbProj, err := s.queries.GetProject(ctx, projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get project: %w", err)
	}

	if dbProj.OwnerID != ownerID {
		return ErrForbidden
	}

	// Look up invitee by email using GetUserByEmail via auth queries
	// For now, we use the same queries instance which has access to users
	invitee, err := s.queries.GetUserByEmail(ctx, inviteeEmail)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("user not found")
		}
		return fmt.Errorf("find user: %w", err)
	}

	return s.queries.AddProjectMember(ctx, dbgen.AddProjectMemberParams{
		ProjectID: projectID,
		UserID:    invitee.ID,
		Role:      dbgen.ProjectRoleEditor,
	})
}

func (s *Service) ListMembers(ctx context.Context, projectID, userID string) ([]Member, error) {
	if err := s.checkMembership(ctx, projectID, userID); err != nil {
		return nil, err
	}

	dbMembers, err := s.queries.ListProjectMembers(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}

	members := make([]Member, len(dbMembers))
	for i, m := range dbMembers {
		members[i] = Member{
			UserID:      m.UserID,
			Role:        string(m.Role),
			DisplayName: m.DisplayName,
			Email:       m.Email,
		}
	}

	return members, nil
}

func (s *Service) RemoveMember(ctx context.Context, projectID, ownerID, targetUserID string) error {
	dbProj, err := s.queries.GetProject(ctx, projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get project: %w", err)
	}

	if dbProj.OwnerID != ownerID {
		return ErrForbidden
	}

	if targetUserID == ownerID {
		return errors.New("cannot remove project owner")
	}

	return s.queries.RemoveProjectMember(ctx, dbgen.RemoveProjectMemberParams{
		ProjectID: projectID,
		UserID:    targetUserID,
	})
}

func (s *Service) GetLatestSnapshot(ctx context.Context, projectID, userID string) (json.RawMessage, error) {
	if err := s.checkMembership(ctx, projectID, userID); err != nil {
		return nil, err
	}

	snap, err := s.queries.GetLatestSnapshot(ctx, projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get snapshot: %w", err)
	}

	return snap.Document, nil
}

func (s *Service) checkMembership(ctx context.Context, projectID, userID string) error {
	_, err := s.queries.GetProjectMember(ctx, dbgen.GetProjectMemberParams{
		ProjectID: projectID,
		UserID:    userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotMember
		}
		return fmt.Errorf("check membership: %w", err)
	}
	return nil
}

func dbProjectToProject(p dbgen.Project) *Project {
	return &Project{
		ID:        p.ID,
		Name:      p.Name,
		OwnerID:   p.OwnerID,
		FPS:       int(p.Fps),
		Width:     int(p.Width),
		Height:    int(p.Height),
		CreatedAt: p.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
		UpdatedAt: p.UpdatedAt.Time.Format("2006-01-02T15:04:05Z"),
	}
}
