import { apiFetch } from './client'
import type { InDocument } from '../types/document'

export interface Project {
  id: string
  name: string
  ownerId: string
  fps: number
  width: number
  height: number
  createdAt: string
  updatedAt: string
}

export function listProjects(): Promise<Project[]> {
  return apiFetch<Project[]>('/api/projects')
}

export function createProject(name: string): Promise<Project> {
  return apiFetch<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function getProject(id: string): Promise<Project> {
  return apiFetch<Project>(`/api/projects/${id}`)
}

export function deleteProject(id: string): Promise<void> {
  return apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' })
}

export function inviteToProject(projectId: string, email: string): Promise<void> {
  return apiFetch<void>(`/api/projects/${projectId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function getLatestSnapshot(projectId: string): Promise<InDocument> {
  return apiFetch<InDocument>(`/api/projects/${projectId}/snapshots/latest`)
}
