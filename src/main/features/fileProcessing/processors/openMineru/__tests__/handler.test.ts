import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileInfo } from '@shared/types/file'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: fetchMock }, app: { getLocale: () => 'en-US' } }))

import { openMineruDocumentToMarkdownHandler as handler } from '../documentToMarkdown/handler'

const config: FileProcessorMerged = {
  id: 'open-mineru',
  type: 'api',
  apiKeys: ['secret'],
  capabilities: [
    { feature: 'document_to_markdown', inputs: ['document'], output: 'markdown', apiHost: 'http://127.0.0.1:8000' }
  ]
}
const file = { path: '/document.pdf', name: 'document', ext: 'pdf' } as FileInfo
const state = { protocol: 'v1', apiHost: 'http://127.0.0.1:8000', providerTaskId: 'job-1' }
const health = { status: 'ok', version: '4.0.6', features: { sources: ['file_id'], output_formats: ['markdown'] } }

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterAll(() => vi.unstubAllGlobals())

describe('Open MinerU task preparation and recovery', () => {
  it('chooses the legacy background job for a healthy old service', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'healthy', version: '3.4.5' }))
    expect((await handler.prepare(file, config)).mode).toBe('background')
  })

  it('chooses remote polling for V1', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(health))
    expect((await handler.prepare(file, config)).mode).toBe('remote-poll')
  })

  it('resumes the exact task without health discovery or a new upload, using current credentials', async () => {
    const prepared = await handler.prepare(file, config, undefined, { remoteState: state })
    if (prepared.mode !== 'remote-poll') throw new Error('Expected a remote job')
    const restored = prepared.rehydrate(state, { ...config, apiKeys: ['rotated-secret'] })
    fetchMock.mockResolvedValueOnce(
      Response.json({
        job_id: 'job-1',
        status: 'completed',
        files: [{ status: 'completed', output_files: { markdown: { file_id: 'md-1' } } }]
      })
    )
    fetchMock.mockResolvedValueOnce(new Response('# restored'))
    expect(await prepared.pollRemote(restored)).toEqual({
      status: 'completed',
      output: { kind: 'markdown', markdownContent: '# restored' }
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8000/v1/parse/jobs/job-1',
      'http://127.0.0.1:8000/v1/files/md-1/content'
    ])
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer rotated-secret')
    expect(prepared.toPersistable(restored.remoteContext, restored.providerTaskId)).toEqual(state)
  })

  it.each([
    null,
    {},
    { ...state, protocol: 'legacy' },
    { ...state, providerTaskId: '' },
    { ...state, apiHost: 'http://127.0.0.1:9999' },
    { ...state, apiKey: 'leaked' }
  ])('rejects invalid or mismatched recovery data before sending credentials', async (remoteState) => {
    await expect(handler.prepare(file, config, undefined, { remoteState })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['partial', 'failed', 'canceled'])(
    'does not persist a %s result as a successful document',
    async (status) => {
      const prepared = await handler.prepare(file, config, undefined, { remoteState: state })
      if (prepared.mode !== 'remote-poll') throw new Error('Expected a remote job')
      fetchMock.mockResolvedValueOnce(Response.json({ job_id: 'job-1', status, files: [{ status: 'failed' }] }))
      expect(await prepared.pollRemote(prepared.rehydrate(state, config))).toMatchObject({ status: 'failed' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects completed tasks missing the requested artifact', async () => {
    const prepared = await handler.prepare(file, config, undefined, { remoteState: state })
    if (prepared.mode !== 'remote-poll') throw new Error('Expected a remote job')
    fetchMock.mockResolvedValueOnce(
      Response.json({ job_id: 'job-1', status: 'completed', files: [{ status: 'completed' }] })
    )
    await expect(prepared.pollRemote(prepared.rehydrate(state, config))).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not switch protocols or resubmit when the remote job has disappeared', async () => {
    const prepared = await handler.prepare(file, config, undefined, { remoteState: state })
    if (prepared.mode !== 'remote-poll') throw new Error('Expected a remote job')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(prepared.pollRemote(prepared.rehydrate(state, config))).rejects.toThrow()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:8000/v1/parse/jobs/job-1'])
  })
})
