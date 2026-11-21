import { afterEach, describe, expect, it, vi } from 'vitest'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

const storage = memoryStorage()
vi.stubGlobal('localStorage', storage)
vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${Math.random()}`) })

const { useProjects, normalizeEndpoint, normalizeWorkspace, selectActiveProjects, selectArchivedProjects, selectSelectedProjectId } = await import('./projects')

afterEach(() => {
  useProjects.setState({ projects: [], selectedProjectIds: {} })
  storage.removeItem('phoson-projects')
})

describe('project catalog', () => {
  it('normalizes workspace separators while preserving roots', () => {
    expect(normalizeWorkspace('/work/project///')).toBe('/work/project')
    expect(normalizeWorkspace('/')).toBe('/')
    expect(normalizeWorkspace('C:\\')).toBe('C:\\')
  })

  it('normalizes remote endpoints and deduplicates endpoint/path pairs', () => {
    expect(normalizeEndpoint('HTTPS://EXAMPLE.COM:443/api/')).toBe('https://example.com/api')
    const first = useProjects.getState().addProject('One', '/work/project/', 'https://EXAMPLE.com:443/api/')
    const duplicate = useProjects.getState().addProject('Other', '/work/project', 'https://example.com/api')
    expect(duplicate).toBe(first)
    expect(useProjects.getState().projects).toHaveLength(1)
    expect(useProjects.getState().addProject('Local', '/work/project', 'local')).not.toBe(first)
  })

  it('renames and archives as catalog metadata only', () => {
    const project = useProjects.getState().addProject('Name', '/workspace', 'local')
    useProjects.getState().renameProject(project.id, 'Renamed')
    useProjects.getState().archiveProject(project.id)
    expect(useProjects.getState().projects[0]).toMatchObject({ name: 'Renamed', archived: true })
    expect(selectActiveProjects(useProjects.getState())).toEqual([])
    expect(selectArchivedProjects(useProjects.getState())).toHaveLength(1)
    useProjects.getState().archiveProject(project.id, false)
    expect(useProjects.getState().projects[0].archived).toBe(false)
  })

  it('keeps selection scoped to endpoint', () => {
    const local = useProjects.getState().addProject('Local', '/a', 'local')
    const remote = useProjects.getState().addProject('Remote', '/a', 'https://host.test')
    useProjects.getState().selectProject(local.id)
    useProjects.getState().selectProject(remote.id)
    expect(selectSelectedProjectId('local')(useProjects.getState())).toBe(local.id)
    expect(selectSelectedProjectId('https://host.test/')(useProjects.getState())).toBe(remote.id)
  })

  it('validates input, revives duplicates, and enforces valid selections', () => {
    expect(() => useProjects.getState().addProject('  ', '/x', 'local')).toThrow()
    expect(() => useProjects.getState().addProject('Name', ' ', 'local')).toThrow()
    expect(() => useProjects.getState().addProject('Name', '/x', ' ')).toThrow()
    const project = useProjects.getState().addProject(' Name ', '/x', 'local')
    expect(project.name).toBe('Name')
    useProjects.getState().selectProject('missing', 'local')
    useProjects.getState().selectProject(project.id, 'https://wrong.test')
    expect(selectSelectedProjectId('local')(useProjects.getState())).toBeNull()
    useProjects.getState().selectProject(project.id, 'local')
    useProjects.getState().archiveProject(project.id)
    expect(selectSelectedProjectId('local')(useProjects.getState())).toBeNull()
    expect(useProjects.getState().addProject('Revived', '/x/', 'local').archived).toBe(false)
    useProjects.getState().renameProject(project.id, ' Renamed ')
    expect(useProjects.getState().projects[0].name).toBe('Renamed')
    expect(() => useProjects.getState().renameProject(project.id, '  ')).toThrow()
  })

  it('persists and filters invalid records on hydration', async () => {
    storage.setItem('phoson-projects', JSON.stringify({ state: { projects: [
      { id: 'ok', name: 'Ok', workspace: '/x/', endpoint: 'local' },
      { id: 2, name: 'bad', workspace: '/x', endpoint: 'local' },
    ], selectedProjectIds: { local: 'ok' } }, version: 0 }))
    await useProjects.persist.rehydrate()
    expect(useProjects.getState().projects).toEqual([{ id: 'ok', name: 'Ok', workspace: '/x', endpoint: 'local' }])
    expect(useProjects.getState().selectedProjectIds.local).toBe('ok')
  })
})
