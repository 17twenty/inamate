-- name: CreateUser :one
INSERT INTO users (id, email, password, display_name)
VALUES ($1, $2, $3, $4)
RETURNING id, email, display_name, created_at, updated_at;

-- name: GetUserByEmail :one
SELECT id, email, password, display_name, created_at, updated_at
FROM users
WHERE email = $1;

-- name: GetUserByID :one
SELECT id, email, display_name, created_at, updated_at
FROM users
WHERE id = $1;
