-- name: CreateProject :one
INSERT INTO projects (id, name, owner_id)
VALUES ($1, $2, $3)
RETURNING id, name, owner_id, fps, width, height, created_at, updated_at;

-- name: GetProject :one
SELECT id, name, owner_id, fps, width, height, created_at, updated_at
FROM projects
WHERE id = $1;

-- name: ListProjectsForUser :many
SELECT p.id, p.name, p.owner_id, p.fps, p.width, p.height, p.created_at, p.updated_at
FROM projects p
JOIN project_members pm ON p.id = pm.project_id
WHERE pm.user_id = $1
ORDER BY p.updated_at DESC;

-- name: DeleteProject :exec
DELETE FROM projects WHERE id = $1;

-- name: AddProjectMember :exec
INSERT INTO project_members (project_id, user_id, role)
VALUES ($1, $2, $3);

-- name: GetProjectMember :one
SELECT project_id, user_id, role, invited_at
FROM project_members
WHERE project_id = $1 AND user_id = $2;

-- name: ListProjectMembers :many
SELECT pm.project_id, pm.user_id, pm.role, pm.invited_at, u.display_name, u.email
FROM project_members pm
JOIN users u ON pm.user_id = u.id
WHERE pm.project_id = $1
ORDER BY pm.invited_at;

-- name: RemoveProjectMember :exec
DELETE FROM project_members WHERE project_id = $1 AND user_id = $2;

-- name: CreateSnapshot :one
INSERT INTO project_snapshots (id, project_id, version, document)
VALUES ($1, $2, $3, $4)
RETURNING id, project_id, version, document, created_at;

-- name: GetLatestSnapshot :one
SELECT id, project_id, version, document, created_at
FROM project_snapshots
WHERE project_id = $1
ORDER BY version DESC
LIMIT 1;
