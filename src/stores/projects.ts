import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Project = {
  id: string
  name: string
  workspace: string
  endpoint: string
  archived?: boolean
}

type ProjectsState = {
  projects: Project[]
  selectedProjectIds: Record<string, string | null>
  addProject: (name: string, workspace: string, endpoint: string) => Project
  renameProject: (id: string, name: string) => void
  archiveProject: (id: string, archived?: boolean) => void
  selectProject: (id: string | null, endpoint?: string) => void
}

export const normalizeWorkspace = (workspace: string): string => {
  if (!workspace) return workspace
  const root = /^([a-zA-Z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?|[\\/])$/.test(workspace)
  return root ? workspace : workspace.replace(/[\\/]+$/, '')
}

export const normalizeEndpoint = (endpoint: string): string => {
  if (endpoint === 'local') return endpoint
  try {
    const url = new URL(endpoint.trim())
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '')
  } catch {
    return endpoint.trim()
  }
}

const validProject = (value: unknown): value is Project => {
  if (!value || typeof value !== 'object') return false
  const project = value as Project
  return typeof project.id === 'string' && typeof project.name === 'string' &&
    typeof project.workspace === 'string' && typeof project.endpoint === 'string' &&
    (project.archived === undefined || typeof project.archived === 'boolean')
}

const storage = createJSONStorage<ProjectsState>(() => globalThis.localStorage)

export const useProjects = create<ProjectsState>()(persist((set, get) => ({
  projects: [],
  selectedProjectIds: {},
  addProject: (name, workspace, endpoint) => {
    const cleanName = name.trim()
    const normalizedWorkspace = normalizeWorkspace(workspace.trim())
    const normalizedEndpoint = normalizeEndpoint(endpoint.trim())
    if (!cleanName || !normalizedWorkspace || !normalizedEndpoint) throw new Error('Project name, workspace, and endpoint are required')
    const existing = get().projects.find(project => project.endpoint === normalizedEndpoint && project.workspace === normalizedWorkspace)
    if (existing) {
      if (existing.archived) set(state => ({ projects: state.projects.map(project => project.id === existing.id ? { ...project, archived: false } : project) }))
      return existing.archived ? { ...existing, archived: false } : existing
    }
    const project: Project = { id: crypto.randomUUID(), name: cleanName, workspace: normalizedWorkspace, endpoint: normalizedEndpoint }
    set(state => ({ projects: [...state.projects, project] }))
    return project
  },
  renameProject: (id, name) => {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('Project name is required')
    set(state => ({ projects: state.projects.map(project => project.id === id ? { ...project, name: cleanName } : project) }))
  },
  archiveProject: (id, archived = true) => set(state => {
    const project = state.projects.find(item => item.id === id)
    return { projects: state.projects.map(item => item.id === id ? { ...item, archived } : item), ...(archived && project ? { selectedProjectIds: Object.fromEntries(Object.entries(state.selectedProjectIds).map(([scope, selected]) => [scope, selected === id ? null : selected])) } : {}) }
  }),
  selectProject: (id, endpoint) => {
    const scope = normalizeEndpoint(endpoint ?? (id ? get().projects.find(project => project.id === id)?.endpoint ?? 'local' : 'local'))
    if (id !== null) {
      const project = get().projects.find(item => item.id === id)
      if (!project || project.archived || project.endpoint !== scope) return
    }
    set(state => ({ selectedProjectIds: { ...state.selectedProjectIds, [scope]: id } }))
  },
}), {
  name: 'phoson-projects',
  storage,
  partialize: state => ({ projects: state.projects, selectedProjectIds: state.selectedProjectIds }) as ProjectsState,
  merge: (persisted, current) => {
    const value = persisted as Partial<ProjectsState> | undefined
    return {
      ...current,
      projects: Array.isArray(value?.projects) ? value.projects.filter(validProject).map(project => ({ ...project, name: project.name.trim(), workspace: normalizeWorkspace(project.workspace.trim()), endpoint: normalizeEndpoint(project.endpoint.trim()) })).filter(project => project.id.trim() && project.name && project.workspace && project.endpoint).filter((project, index, projects) => projects.findIndex(other => other.endpoint === project.endpoint && other.workspace === project.workspace) === index).filter((project, index, projects) => projects.findIndex(other => other.id === project.id) === index) : [],
      selectedProjectIds: (() => {
        const projects = Array.isArray(value?.projects) ? value.projects.filter(validProject).map(project => ({ ...project, workspace: normalizeWorkspace(project.workspace.trim()), endpoint: normalizeEndpoint(project.endpoint.trim()) })).filter(project => project.id.trim() && project.name.trim() && project.workspace && project.endpoint).filter((project, index, all) => all.findIndex(other => other.endpoint === project.endpoint && other.workspace === project.workspace) === index).filter((project, index, all) => all.findIndex(other => other.id === project.id) === index) : []
        const raw = value?.selectedProjectIds
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
        return Object.fromEntries(Object.entries(raw).filter(([endpoint, id]) => typeof id === 'string' && projects.some(project => project.id === id && !project.archived && project.endpoint === normalizeEndpoint(endpoint))).map(([endpoint, id]) => [normalizeEndpoint(endpoint), id]))
      })(),
    }
  },
}))

export const selectProjects = (state: ProjectsState) => state.projects
export const selectActiveProjects = (state: ProjectsState) => state.projects.filter(project => !project.archived)
export const selectArchivedProjects = (state: ProjectsState) => state.projects.filter(project => project.archived)
export const selectProjectById = (id: string) => (state: ProjectsState) => state.projects.find(project => project.id === id)
export const selectSelectedProjectId = (endpoint = 'local') => (state: ProjectsState) => state.selectedProjectIds[normalizeEndpoint(endpoint)] ?? null
export const selectSelectedProject = (endpoint = 'local') => (state: ProjectsState) => {
  const id = state.selectedProjectIds[normalizeEndpoint(endpoint)]
  return state.projects.find(project => project.id === id)
}
