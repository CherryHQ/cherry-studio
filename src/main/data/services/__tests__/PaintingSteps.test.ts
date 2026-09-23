import { setupTestDatabase } from '@test-helpers/db'
import { defaultServiceInstances } from '@test-mocks/main/application'
import { describe, expect, it, vi } from 'vitest'

import { fileEntryTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'

import { paintingService } from '../PaintingService'

const dbh = setupTestDatabase()
function file(id: string) {
  dbh.db.insert(fileEntryTable).values({ id, origin: 'internal', name: id, ext: 'png', size: 42 }).run()
}
function root(id: string) {
  file(id + '-image')
  return paintingService.create({
    id,
    providerId: 'test',
    modelId: 'gpt-image-2.5',
    prompt: 'original',
    files: { input: [], output: [id + '-image'] }
  })
}
function edit(id: string, project: string, parent: string, source: string) {
  return paintingService.create({
    id,
    providerId: 'test',
    modelId: 'gpt-image-2.5',
    projectId: project,
    parentId: parent,
    sourceFileId: source,
    operation: 'edit',
    stepStatus: 'running',
    params: { aspectRatio: '1:1' },
    prompt: 'turn blue',
    files: { input: [source], output: [] }
  })
}

describe('persisted painting projects and steps', () => {
  it('publishes both step and project read models after background results are persisted', () => {
    root('project')
    edit('step', 'project', 'project', 'project-image')
    file('result')
    const notify = defaultServiceInstances.WindowManager.broadcast
    notify.mockClear()
    let observed: ReturnType<typeof paintingService.getById> | undefined
    const observation = vi.spyOn(defaultServiceInstances.WindowManager, 'broadcast').mockImplementation(() => {
      observed = paintingService.getById('step')
    })
    try {
      paintingService.update('step', {
        stepStatus: 'completed',
        files: { input: ['project-image'], output: ['result'] }
      })
      expect(observed).toMatchObject({ stepStatus: 'completed', files: { output: ['result'] } })
      expect(observation.mock.calls[0][1]).toEqual([
        { endpoint: '/paintings', kind: 'projection', entityIds: ['step', 'project'] },
        { endpoint: '/paintings/:id', entityIds: ['step', 'project'] }
      ])
    } finally {
      observation.mockRestore()
    }
  })

  it('returns all project members beyond the paginated history limit', () => {
    root('project')
    root('other')
    for (let index = 0; index < 105; index++) edit(`step-${index}`, 'project', 'project', 'project-image')
    expect(paintingService.getProjectStepIds('project')).toHaveLength(106)
    expect(paintingService.getProjectStepIds('project')).not.toContain('other')
    expect(() => paintingService.getProjectStepIds('step-0')).toThrow('Expected a project root')
  })
  it('moves and restores the entire project without losing versions, then purges it as a unit', () => {
    root('trash-project')
    edit('trash-step', 'trash-project', 'trash-project', 'trash-project-image')
    paintingService.selectStep('trash-project', 'trash-step')
    paintingService.delete('trash-project')
    expect(paintingService.list({ inTrash: true, limit: 100 }).items.map((item) => item.id)).toEqual(['trash-project'])
    expect(() => paintingService.getById('trash-step')).toThrow()
    expect(dbh.db.select().from(paintingTable).all()).toHaveLength(2)
    const restored = paintingService.restore('trash-project')
    expect(restored.selectedStepId).toBe('trash-step')
    expect(paintingService.getById('trash-step').sourceFileId).toBe('trash-project-image')
    paintingService.delete('trash-project')
    paintingService.delete('trash-project', { permanent: true })
    expect(dbh.db.select().from(paintingTable).all()).toHaveLength(0)
  })

  it('previews the selected successful version and falls back after a canceled first version', () => {
    paintingService.create({
      id: 'canceled-root',
      providerId: 'test',
      prompt: 'first',
      stepStatus: 'canceled',
      files: { input: [], output: [] }
    })
    const child = (id: string) =>
      paintingService.create({
        id,
        providerId: 'test',
        projectId: 'canceled-root',
        prompt: id,
        stepStatus: 'running',
        files: { input: [], output: [] }
      })
    child('second')
    paintingService.selectStep('canceled-root', 'second')
    const preview = () =>
      paintingService.list({ projectsOnly: true, limit: 100 }).items.find((p) => p.id === 'canceled-root')!
    expect(preview().previewFileId).toBeUndefined()
    file('second-a')
    file('second-b')
    paintingService.update('second', {
      stepStatus: 'completed',
      files: { input: [], output: ['second-a', 'second-b'] }
    })
    expect(preview().previewFileId).toBe('second-a')
    child('third')
    file('third-image')
    paintingService.update('third', { stepStatus: 'completed', files: { input: [], output: ['third-image'] } })
    paintingService.selectStep('canceled-root', 'second', 'second-b')
    expect(preview().previewFileId).toBe('second-b')
    paintingService.selectStep('canceled-root', 'canceled-root')
    expect(preview().previewFileId).toBe('third-image')
    expect(preview().files.output).toEqual([])
    expect(paintingService.getById('canceled-root').files.output).toEqual([])
  })

  it('keeps the original and branches with independent metadata and selected output', () => {
    const original = root('project')
    const first = edit('v2', original.id, original.id, 'project-image')
    file('blue')
    paintingService.update(first.id, { files: { input: ['project-image'], output: ['blue'] }, stepStatus: 'completed' })
    edit('v3', original.id, first.id, 'blue')
    const branch = edit('v4', original.id, original.id, 'project-image')
    expect(branch.stepNumber).toBe(4)
    expect(paintingService.list({ projectId: original.id, limit: 100 }).total).toBe(4)
    expect(paintingService.list({ projectsOnly: true, limit: 100 }).items.map((p) => p.id)).toEqual(['project'])
    paintingService.selectStep(original.id, first.id, 'blue')
    expect(paintingService.getById(original.id).selectedStepId).toBe(first.id)
    expect(paintingService.getById(original.id).files.output).toEqual(['project-image'])
    expect(paintingService.getById(branch.id)).toMatchObject({
      parentId: original.id,
      sourceFileId: 'project-image',
      operation: 'edit',
      params: { aspectRatio: '1:1' },
      prompt: 'turn blue'
    })
    expect(() => paintingService.update(first.id, { prompt: 'overwrite history' })).toThrow()
  })

  it('rejects cross-project parents and image selection without committing a partial step', () => {
    root('a')
    root('b')
    expect(() => edit('bad', 'a', 'b', 'b-image')).toThrow()
    expect(() => edit('bad-image', 'a', 'a', 'b-image')).toThrow()
    expect(() => paintingService.selectStep('a', 'b')).toThrow()
    expect(() => paintingService.selectStep('a', 'a', 'b-image')).toThrow()
    expect(paintingService.list({ projectId: 'a', limit: 100 }).total).toBe(1)
  })

  it('deletes a whole project while preserving shared source files and unrelated projects', () => {
    root('a')
    root('b')
    edit('v2', 'a', 'a', 'a-image')
    expect(() => paintingService.delete('v2')).toThrow()
    paintingService.delete('a')
    expect(paintingService.list({ projectId: 'a', limit: 100 }).total).toBe(0)
    expect(paintingService.getById('b').files.output).toEqual(['b-image'])
    expect(
      dbh.db
        .select()
        .from(fileEntryTable)
        .all()
        .map((f) => f.id)
    ).toContain('a-image')
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
