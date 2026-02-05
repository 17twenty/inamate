import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'

export function ProjectListPage() {
  const { user, logout } = useAuthStore()
  const { projects, loading, fetchProjects, createProject, deleteProject } = useProjectStore()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const project = await createProject(newName.trim())
      setShowCreate(false)
      setNewName('')
      navigate(`/editor/${project.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <h1 className="text-xl font-bold text-white">Inamate</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user?.displayName}</span>
          <button
            onClick={logout}
            className="rounded px-3 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Projects</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Project
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="mb-6 flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              autoFocus
              className="flex-1 rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded px-3 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-700 py-12 text-center">
            <p className="text-gray-500">No projects yet. Create your first one!</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => navigate(`/editor/${project.id}`)}
                className="group cursor-pointer rounded-lg border border-gray-800 bg-gray-900 p-4 transition hover:border-gray-600"
              >
                <h3 className="font-medium text-white group-hover:text-blue-400">
                  {project.name}
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  {project.width}x{project.height} @ {project.fps}fps
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-gray-600">
                    {new Date(project.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm('Delete this project?')) {
                        deleteProject(project.id)
                      }
                    }}
                    className="rounded px-2 py-1 text-xs text-gray-600 opacity-0 hover:bg-red-900/50 hover:text-red-400 group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
