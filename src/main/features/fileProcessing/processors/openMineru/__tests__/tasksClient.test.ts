import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileInfo } from '@shared/types/file'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: fetchMock }, app: { getLocale: () => 'en-US' } }))
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }))

import { openMineruDocumentToMarkdownHandler as handler } from '../documentToMarkdown/handler'
import { createParseTask, downloadTaskMarkdown, getParseTask, uploadTaskFile } from '../tasksClient'

const connection = { apiHost: 'https://mineru.example.com/prefix', apiKey: 'secret' }
const config: FileProcessorMerged = {
  id: 'open-mineru',
  type: 'api',
  apiKeys: ['secret'],
  capabilities: [
    { feature: 'document_to_markdown', inputs: ['document'], output: 'markdown', apiHost: connection.apiHost }
  ]
}
const state = { protocol: 'tasks', apiHost: connection.apiHost, providerTaskId: 'task-1' }
const health = {
  status: 'ok',
  version: '4.1.3',
  features: { sources: ['upload', 'url'], task_output_formats: ['default', 'docx'] }
}
const waiting = {
  task_id: 'task-1',
  status: 'waiting-file',
  files: [
    {
      file_id: 'file-1',
      status: 'waiting-file',
      upload: { url: `${connection.apiHost}/v1/tasks/task-1/uploads/file-1`, headers: {} }
    }
  ]
}
let dir: string
let file: FileInfo
let zipBytes: ArrayBuffer
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mineru-tasks-'))
  const filePath = path.join(dir, 'document.pdf')
  await fs.writeFile(filePath, 'pdf-data')
  file = { path: filePath, name: 'document', ext: 'pdf', size: 8, mime: 'application/pdf' } as FileInfo
  const zip = new JSZip()
  zip.file('markdown.md', '# Parsed document\n\n中文内容')
  zipBytes = await zip.generateAsync({ type: 'arraybuffer' })
})
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('CHERRY_STUDIO_NODE_PROXY_RULES', undefined)
  vi.mocked(application.getPath).mockReturnValue(path.join(dir, 'downloads'))
})
afterAll(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await fs.rm(dir, { recursive: true, force: true })
})

async function restore() {
  const prepared = await handler.prepare(file, config, undefined, { remoteState: state })
  if (prepared.mode !== 'remote-poll') throw new Error('Expected remote polling')
  return { prepared, job: prepared.rehydrate(state, { ...config, apiKeys: ['rotated'] }) }
}

describe('MinerU 4.1 Tasks', () => {
  it('persists the created task before upload and reads Markdown from its ZIP result', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(health))
    const prepared = await handler.prepare(file, config)
    if (prepared.mode !== 'remote-poll') throw new Error('Expected remote polling')
    fetchMock.mockResolvedValueOnce(Response.json(waiting, { status: 202 }))
    const job = await prepared.startRemote()
    expect(prepared.toPersistable(job.remoteContext, job.providerTaskId)).toEqual(state)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${connection.apiHost}/v1/health`,
      `${connection.apiHost}/v1/tasks`
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      files: [{ file_name: 'document.pdf', bytes: 8, page_range: 'all' }],
      output_formats: ['default']
    })
    fetchMock.mockResolvedValueOnce(Response.json(waiting)).mockResolvedValueOnce(new Response(null))
    expect(await prepared.pollRemote(job)).toEqual({ status: 'pending', progress: 0 })
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[3]
    expect(uploadUrl).toBe(waiting.files[0].upload.url)
    expect(uploadInit.method).toBe('PUT')
    expect(await uploadInit.body.text()).toBe('pdf-data')
    expect(new Headers(uploadInit.headers).get('Authorization')).toBe('Bearer secret')
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          task_id: 'task-1',
          status: 'completed',
          files: [
            {
              file_id: 'file-1',
              status: 'completed',
              result_url: `${connection.apiHost}/v1/files/file-1/content`
            }
          ]
        })
      )
      .mockResolvedValueOnce(new Response(zipBytes, { headers: { 'Content-Type': 'application/zip' } }))
    expect(await prepared.pollRemote(job)).toEqual({
      status: 'completed',
      output: { kind: 'markdown', markdownContent: '# Parsed document\n\n中文内容' }
    })
    expect(await fs.readdir(path.join(dir, 'downloads'))).toEqual([])
  })

  it.each(['waiting-file', 'pending', 'running'])(
    'resumes %s without recreating or uploading without an upload descriptor',
    async (status) => {
      const { prepared, job } = await restore()
      fetchMock.mockResolvedValueOnce(
        Response.json({ task_id: 'task-1', status, files: [{ file_id: 'file-1', status }] })
      )
      expect(await prepared.pollRemote(job)).toEqual({
        status: status === 'running' ? 'processing' : 'pending',
        progress: 0
      })
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${connection.apiHost}/v1/tasks/task-1`])
      expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer rotated')
    }
  )

  it.each(['partial', 'failed', 'canceled'])(
    'reports %s without downloading an incomplete artifact',
    async (status) => {
      const { prepared, job } = await restore()
      fetchMock.mockResolvedValueOnce(
        Response.json({ task_id: 'task-1', status, files: [{ file_id: 'file-1', status: 'failed' }] })
      )
      expect(await prepared.pollRemote(job)).toMatchObject({ status: 'failed' })
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${connection.apiHost}/v1/tasks/task-1`])
    }
  )

  it('rejects completed tasks without a result URL', async () => {
    const { prepared, job } = await restore()
    fetchMock.mockResolvedValueOnce(
      Response.json({ task_id: 'task-1', status: 'completed', files: [{ file_id: 'file-1', status: 'completed' }] })
    )
    await expect(prepared.pollRemote(job)).rejects.toThrow()
  })

  it('does not resubmit an expired task', async () => {
    const { prepared, job } = await restore()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(prepared.pollRemote(job)).rejects.toThrow()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${connection.apiHost}/v1/tasks/task-1`])
  })

  it('rejects a response for a different task', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...waiting, task_id: 'other' }))
    await expect(getParseTask(connection, 'task-1')).rejects.toThrow()
  })

  it('does not retry creation after an HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(createParseTask(connection, file)).rejects.toThrow()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${connection.apiHost}/v1/tasks`])
  })

  it('uses signed upload headers without leaking the API key to storage', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null))
    await uploadTaskFile(connection, file, {
      url: 'https://storage.example.com/upload',
      headers: { 'x-signature': 'signed' }
    })
    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('x-signature')).toBe('signed')
    expect(await fetchMock.mock.calls[0][1].body.text()).toBe('pdf-data')
  })

  it('drops API credentials when a ZIP download redirects to storage', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://storage.example.com/result' } })
    )
    fetchMock.mockResolvedValueOnce(new Response(zipBytes, { headers: { 'Content-Type': 'application/zip' } }))
    expect(await downloadTaskMarkdown(connection, `${connection.apiHost}/v1/files/file-1/content`)).toContain(
      '# Parsed document'
    )
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer secret')
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBeNull()
  })

  it('rejects unrelated private download hosts before sending credentials', async () => {
    await expect(downloadTaskMarkdown(connection, 'http://127.0.0.1/private')).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-ZIP result bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(downloadTaskMarkdown(connection, `${connection.apiHost}/result`)).rejects.toThrow()
  })
})
