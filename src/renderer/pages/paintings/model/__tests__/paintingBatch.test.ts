import { describe, expect, it, vi } from 'vitest'

import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file'

import {
  type PaintingBatchDeps,
  type PaintingTarget,
  planPaintingBatch,
  runPaintingBatchRequest
} from '../paintingBatch'

const flux: PaintingTarget = { providerId: 'siliconflow', modelId: 'flux-kontext' }
const gpt: PaintingTarget = { providerId: 'openai', modelId: 'gpt-image-1' }
const imagen: PaintingTarget = { providerId: 'google', modelId: 'imagen-4' }

const entry = (id: string) => ({ id, ext: '.png' }) as unknown as FileEntry
const output = (id: string) => ({ id, path: `/images/${id}.png`, ext: '.png' }) as unknown as FileMetadata

function plan(overrides: Partial<Parameters<typeof planPaintingBatch>[0]> = {}) {
  return planPaintingBatch({
    batchId: 'batch-1',
    targets: [flux, gpt, imagen],
    primary: flux,
    prompt: 'a serene mountain lake at sunset',
    mode: 'generate',
    inputFiles: [],
    draftParams: { size: '1024x1024' },
    acceptsImageInput: () => true,
    ...overrides
  })
}

describe('planPaintingBatch', () => {
  it('sends the shared prompt and batch id to every target, each under its own model', () => {
    const requests = plan()

    expect(requests.map((r) => r.target)).toEqual([flux, gpt, imagen])
    expect(new Set(requests.map((r) => r.batchId))).toEqual(new Set(['batch-1']))
    expect(new Set(requests.map((r) => r.prompt))).toEqual(new Set(['a serene mountain lake at sunset']))
  })

  it('shares draft parameters only with the primary model', () => {
    const [primary, ...others] = plan()

    expect(primary.params).toEqual({ size: '1024x1024' })
    expect(others.map((r) => r.params)).toEqual([{}, {}])
  })

  it('gives references to image-input targets and flags the rest without them', () => {
    const refs = [entry('ref-1')]
    const requests = plan({
      inputFiles: refs,
      acceptsImageInput: (target) => target.modelId !== 'gpt-image-1'
    })

    expect(requests[0]).toMatchObject({ inputFiles: refs, referencesIgnored: false })
    expect(requests[1]).toMatchObject({ inputFiles: [], referencesIgnored: true })
    expect(requests[2]).toMatchObject({ inputFiles: refs, referencesIgnored: false })
  })

  it('flags nothing when no references are attached', () => {
    const requests = plan({ acceptsImageInput: () => false })

    expect(requests.every((r) => r.referencesIgnored === false && r.inputFiles.length === 0)).toBe(true)
  })
})

function fakeDeps(overrides: Partial<PaintingBatchDeps> = {}) {
  const deps: PaintingBatchDeps = {
    loadProvider: vi.fn(async (providerId: string) => ({
      id: providerId,
      name: providerId,
      isEnabled: true,
      apiHost: 'https://example.test',
      getApiKey: async () => 'key'
    })),
    createPainting: vi.fn(async () => ({})),
    updatePainting: vi.fn(async () => ({})),
    generate: vi.fn(async () => [output('out-1')]),
    ...overrides
  }
  return deps
}

const request = (target: PaintingTarget, params: Record<string, unknown> = {}) =>
  plan({ targets: [target], primary: target, draftParams: params })[0]

describe('runPaintingBatchRequest', () => {
  it('stores each target as its own row carrying the batch id and its own parameters', async () => {
    const deps = fakeDeps()
    const req = request(gpt, { quality: 'high' })

    const files = await runPaintingBatchRequest(req, 'row-gpt', new AbortController(), deps)

    expect(deps.createPainting).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-gpt',
        providerId: 'openai',
        modelId: 'gpt-image-1',
        batchId: 'batch-1',
        params: { quality: 'high' }
      })
    )
    expect(deps.updatePainting).toHaveBeenCalledWith('row-gpt', { files: { output: ['out-1'], input: [] } })
    expect(files).toEqual([output('out-1')])
  })

  it('sends no reference images to a target that cannot use them', async () => {
    const deps = fakeDeps()
    const refs = [entry('ref-1')]
    const ignored = plan({ targets: [gpt], primary: flux, inputFiles: refs, acceptsImageInput: () => false })[0]

    await runPaintingBatchRequest(ignored, 'row-gpt', new AbortController(), deps)

    expect(deps.generate).toHaveBeenCalledWith(
      expect.objectContaining({ painting: expect.objectContaining({ inputFiles: [] }) })
    )
    expect(deps.updatePainting).toHaveBeenCalledWith('row-gpt', { files: { output: ['out-1'], input: [] } })
  })

  it('creates no row for a disabled provider', async () => {
    const deps = fakeDeps({
      loadProvider: vi.fn(async (providerId: string) => ({
        id: providerId,
        name: providerId,
        isEnabled: false,
        apiHost: '',
        getApiKey: async () => ''
      }))
    })

    await expect(runPaintingBatchRequest(request(gpt), 'row-gpt', new AbortController(), deps)).rejects.toMatchObject({
      code: 'PROVIDER_DISABLED'
    })
    expect(deps.createPainting).not.toHaveBeenCalled()
  })

  it('leaves no output on the row when generation fails, and rethrows the failure', async () => {
    const deps = fakeDeps({ generate: vi.fn(async () => Promise.reject(new Error('rate limited'))) })

    await expect(runPaintingBatchRequest(request(gpt), 'row-gpt', new AbortController(), deps)).rejects.toThrow(
      'rate limited'
    )
    expect(deps.updatePainting).not.toHaveBeenCalled()
  })

  it('does not start a request whose column was already canceled', async () => {
    const deps = fakeDeps()
    const controller = new AbortController()
    controller.abort()

    await expect(runPaintingBatchRequest(request(gpt), 'row-gpt', controller, deps)).rejects.toThrow()
    expect(deps.createPainting).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()
  })
})
