package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"

	"github.com/inamate/inamate/backend-go/internal/db/dbgen"
	"github.com/inamate/inamate/backend-go/internal/typeid"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrEmailTaken         = errors.New("email already registered")
)

type Service struct {
	queries   *dbgen.Queries
	jwtSecret []byte
}

func NewService(queries *dbgen.Queries, jwtSecret string) *Service {
	return &Service{
		queries:   queries,
		jwtSecret: []byte(jwtSecret),
	}
}

type AuthResult struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type User struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

func (s *Service) Register(ctx context.Context, email, password, displayName string) (*AuthResult, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	userID := typeid.NewUserID()

	dbUser, err := s.queries.CreateUser(ctx, dbgen.CreateUserParams{
		ID:          userID,
		Email:       email,
		Password:    string(hash),
		DisplayName: displayName,
	})
	if err != nil {
		// Check for unique violation on email
		if isDuplicateKeyError(err) {
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("create user: %w", err)
	}

	token, err := s.issueToken(dbUser.ID)
	if err != nil {
		return nil, err
	}

	return &AuthResult{
		Token: token,
		User: User{
			ID:          dbUser.ID,
			Email:       dbUser.Email,
			DisplayName: dbUser.DisplayName,
		},
	}, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (*AuthResult, error) {
	dbUser, err := s.queries.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("get user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(dbUser.Password), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	token, err := s.issueToken(dbUser.ID)
	if err != nil {
		return nil, err
	}

	return &AuthResult{
		Token: token,
		User: User{
			ID:          dbUser.ID,
			Email:       dbUser.Email,
			DisplayName: dbUser.DisplayName,
		},
	}, nil
}

func (s *Service) ValidateToken(tokenString string) (string, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		return "", fmt.Errorf("parse token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", errors.New("invalid token")
	}

	userID, ok := claims["sub"].(string)
	if !ok {
		return "", errors.New("invalid token subject")
	}

	return userID, nil
}

func (s *Service) GetUser(ctx context.Context, userID string) (*User, error) {
	dbUser, err := s.queries.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("user not found")
		}
		return nil, fmt.Errorf("get user: %w", err)
	}
	return &User{
		ID:          dbUser.ID,
		Email:       dbUser.Email,
		DisplayName: dbUser.DisplayName,
	}, nil
}

func (s *Service) issueToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"sub": userID,
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}

	return signed, nil
}

func isDuplicateKeyError(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505" // unique_violation
	}
	return false
}
