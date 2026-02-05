import { create } from 'zustand'
import * as projectsApi from '../api/projects'

interface ProjectState {
  projects: projectsApi.Project[]
  loading: boolean
  error: string | null
  fetchProjects: () => Promise<void>
  createProject: (name: string) => Promise<projectsApi.Project>
  deleteProject: (id: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null })
    try {
      const projects = await projectsApi.listProjects()
      set({ projects, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  createProject: async (name) => {
    const project = await projectsApi.createProject(name)
    set({ projects: [project, ...get().projects] })
    return project
  },

  deleteProject: async (id) => {
    await projectsApi.deleteProject(id)
    set({ projects: get().projects.filter((p) => p.id !== id) })
  },
}))
