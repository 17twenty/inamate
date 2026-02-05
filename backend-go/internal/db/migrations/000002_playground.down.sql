-- Remove playground project and system user
DELETE FROM project_snapshots WHERE project_id = 'proj_playground';
DELETE FROM projects WHERE id = 'proj_playground';
DELETE FROM users WHERE id = 'usr_system';
