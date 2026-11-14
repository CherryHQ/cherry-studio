import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import AdmZip from 'adm-zip'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileInfo } from '@shared/types/file'

const { fetchMock, fixture } = vi.hoisted(() => ({ fetchMock: vi.fn(), fixture: { dir: '' } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  return { ...mock, application: { ...mock.application, getPath: () => fixture.dir } }
})
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

describe('Open MinerU Tasks protocol', () => {
  const tasksHealth = {
    status: 'ok',
    version: '4.1.3',
    features: { sources: ['upload', 'url'], task_output_formats: ['default', 'docx', 'html', 'latex'], webhook: false }
  }
  const tasksState = {
    protocol: 'tasks',
    apiHost: 'http://127.0.0.1:8000',
    providerTaskId: 'task-1',
    providerFileId: 'file-1'
  }
  const response = (status: string, fileStatus = status, resultUrl?: string) => ({
    task_id: 'task-1',
    status,
    files: [{ file_id: 'file-1', status: fileStatus, ...(resultUrl && { result_url: resultUrl }) }]
  })
  let input: FileInfo
  beforeAll(async () => {
    fixture.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-handler-'))
    const filePath = path.join(fixture.dir, 'document.pdf')
    await fs.writeFile(filePath, 'pdf-data')
    input = { ...file, path: filePath, size: 8 } as FileInfo
  })
  afterAll(async () => {
    await fs.rm(fixture.dir, { recursive: true, force: true })
  })
  it('prepares, starts, polls and persists a complete task', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(tasksHealth))
    const prepared = await handler.prepare(input, config)
    expect(prepared.mode).toBe('remote-poll')
    if (prepared.mode !== 'remote-poll') throw new Error('Expected remote polling')
    fetchMock.mockResolvedValueOnce(Response.json(response('pending')))
    const job = await prepared.startRemote()
    expect(job).toMatchObject({
      providerTaskId: 'task-1',
      remoteContext: { protocol: 'tasks', providerFileId: 'file-1' }
    })
    expect(prepared.toPersistable(job.remoteContext, job.providerTaskId)).toEqual(tasksState)
    for (const [status, expected] of [
      ['waiting-file', 'pending'],
      ['pending', 'pending'],
      ['running', 'processing']
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json(response(status)))
      expect(await prepared.pollRemote(job)).toMatchObject({ status: expected })
    }
    const archive = new AdmZip()
    archive.addFile('markdown.md', Buffer.from('# parsed'))
    fetchMock.mockResolvedValueOnce(Response.json(response('completed', 'completed', '/result')))
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array(archive.toBuffer()), { headers: { 'content-type': 'application/zip' } })
    )
    expect(await prepared.pollRemote(job)).toEqual({
      status: 'completed',
      output: { kind: 'markdown', markdownContent: '# parsed' }
    })
  })
  it.each(['partial', 'failed', 'canceled'])('fails a %s parent even when its file completed', async (status) => {
    const prepared = await handler.prepare(input, config, undefined, { remoteState: tasksState })
    if (prepared.mode !== 'remote-poll') throw new Error('Expected remote polling')
    fetchMock.mockResolvedValueOnce(Response.json(response(status, 'completed', '/result')))
    expect(await prepared.pollRemote(prepared.rehydrate(tasksState, config))).toMatchObject({ status: 'failed' })
    expect(fetchMock.mock.calls).toHaveLength(1)
  })
  it('fails a failed file and rejects a completed file without a result URL', async () => {
    const prepared = await handler.prepare(input, config, undefined, { remoteState: tasksState })
    if (prepared.mode !== 'remote-poll') throw new Error('Expected remote polling')
    const job = prepared.rehydrate(tasksState, config)
    fetchMock.mockResolvedValueOnce(Response.json(response('running', 'failed')))
    expect(await prepared.pollRemote(job)).toMatchObject({ status: 'failed' })
    fetchMock.mockResolvedValueOnce(Response.json(response('completed')))
    await expect(prepared.pollRemote(job)).rejects.toThrow()
  })
  it('rehydrates with rotated credentials and polls only the recorded task', async () => {
    const prepared = await handler.prepare(input, config, undefined, { remoteState: tasksState })
    if (prepared.mode !== 'remote-poll') throw new Error('Expected remote polling')
    const restored = prepared.rehydrate(tasksState, { ...config, apiKeys: ['rotated'] })
    fetchMock.mockResolvedValueOnce(Response.json(response('pending')))
    expect(await prepared.pollRemote(restored)).toMatchObject({ status: 'pending' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:8000/v1/tasks/task-1'])
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe('Bearer rotated')
  })
  it.each([
    { protocol: 'tasks', apiHost: tasksState.apiHost, providerTaskId: 'task-1' },
    { ...tasksState, protocol: 'unknown' },
    { ...tasksState, apiKey: 'secret' },
    { ...tasksState, apiHost: 'http://127.0.0.1:9999' }
  ])('rejects invalid persisted state before requests', async (remoteState) => {
    await expect(handler.prepare(input, config, undefined, { remoteState })).rejects.toThrow()
    expect(fetchMock.mock.calls).toHaveLength(0)
  })
})
