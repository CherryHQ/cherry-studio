import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import AdmZip from 'adm-zip'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileInfo } from '@shared/types/file'

const { fetchMock, transferMock, lookupMock, fixture } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  transferMock: vi.fn(),
  lookupMock: vi.fn(),
  fixture: { dir: '' }
}))
vi.mock('electron', () => ({ net: { fetch: fetchMock }, app: { getLocale: () => 'en-US' } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  return { ...mock, application: { ...mock.application, getPath: () => fixture.dir } }
})
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))
vi.mock('undici', () => ({
  Agent: class {
    async destroy() {}
  }
}))

import { downloadTasksMarkdown, getTasksParseTask, startTasksParse } from '../tasksClient'

const connection = { apiHost: 'http://127.0.0.1:8000/mineru', apiKey: 'secret' }
const receipt = (status = 'waiting-file', upload?: object) => ({
  task_id: 'task-1',
  status,
  files: [{ file_id: 'file-1', status, ...(upload && { upload }) }]
})
let file: FileInfo

beforeAll(async () => {
  fixture.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-unit-'))
  const filePath = path.join(fixture.dir, 'document.pdf')
  await fs.writeFile(filePath, 'pdf-data')
  file = {
    path: filePath,
    name: 'document',
    ext: 'pdf',
    size: (await fs.stat(filePath)).size,
    mime: 'application/pdf'
  } as FileInfo
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await fs.rm(fixture.dir, { recursive: true, force: true })
})
beforeEach(() => {
  fetchMock.mockReset()
  transferMock.mockReset()
  lookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', transferMock)
})

function zip(markdown = true) {
  const archive = new AdmZip()
  if (markdown) archive.addFile('markdown.md', Buffer.from('# exact\n'))
  archive.addFile('images/page.png', Buffer.from('image'))
  return new Uint8Array(archive.toBuffer())
}

describe('Tasks creation and upload', () => {
  it.each(['pdf', 'docx'])('sends the %s manifest to the prefixed endpoint', async (ext) => {
    fetchMock.mockResolvedValueOnce(Response.json(receipt('pending')))
    expect(await startTasksParse(connection, { ...file, ext })).toEqual({ taskId: 'task-1', fileId: 'file-1' })
    expect(fetchMock.mock.calls).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${connection.apiHost}/v1/tasks`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
    expect(JSON.parse(init.body)).toEqual({
      files: [{ file_name: `document.${ext}`, bytes: 8, ...(ext === 'pdf' ? { page_range: 'all' } : {}) }],
      output_formats: ['default']
    })
    expect(transferMock.mock.calls).toHaveLength(0)
  })
  it.each([
    ['/upload', 'Bearer secret'],
    ['https://storage.example.com/upload', null]
  ])('uploads raw bytes to %s with scoped credentials', async (url, auth) => {
    fetchMock.mockResolvedValueOnce(
      Response.json(receipt('waiting-file', { url, headers: { 'x-signature': 'signed' } }))
    )
    transferMock.mockResolvedValueOnce(new Response(null))
    expect(await startTasksParse(connection, file)).toEqual({ taskId: 'task-1', fileId: 'file-1' })
    expect(fetchMock.mock.calls.map(([target]) => target)).toEqual([`${connection.apiHost}/v1/tasks`])
    expect(transferMock.mock.calls).toHaveLength(1)
    const [target, init] = transferMock.mock.calls[0]
    expect(target).toBe(new URL(url, `${connection.apiHost}/`).href)
    expect(init.method).toBe('PUT')
    expect(init.redirect).toBe('manual')
    expect(new Headers(init.headers).get('authorization')).toBe(auth)
    expect(new Headers(init.headers).get('x-signature')).toBe('signed')
    expect(await init.body.text()).toBe('pdf-data')
  })
  it('accepts a JSON PUT response', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(receipt('waiting-file', { url: '/upload' })))
    transferMock.mockResolvedValueOnce(Response.json({ accepted: true }))
    await expect(startTasksParse(connection, file)).resolves.toEqual({ taskId: 'task-1', fileId: 'file-1' })
  })
  it.each([302, 403])('rejects PUT status %i without following it', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json(receipt('waiting-file', { url: '/upload' })))
    transferMock.mockResolvedValueOnce(new Response(null, { status, headers: { location: '/elsewhere' } }))
    await expect(startTasksParse(connection, file)).rejects.toThrow(`HTTP ${status}`)
    expect(transferMock.mock.calls).toHaveLength(1)
  })
  it.each(['waiting-file', 'pending', 'completed'])('does not upload when %s receipt has no upload', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json(receipt(status)))
    await expect(startTasksParse(connection, file)).resolves.toEqual({ taskId: 'task-1', fileId: 'file-1' })
    expect(transferMock.mock.calls).toHaveLength(0)
  })
  it.each([
    { files: [] },
    {
      files: [
        { file_id: '1', status: 'pending' },
        { file_id: '2', status: 'pending' }
      ]
    }
  ])('rejects creation with invalid file count', async ({ files }) => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...receipt('pending'), files }))
    await expect(startTasksParse(connection, file)).rejects.toThrow('invalid or unsupported response')
  })
})

describe('Tasks polling and results', () => {
  it('encodes the task ID and validates both IDs', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...receipt('pending'), task_id: 'task /1' }))
    await expect(getTasksParseTask(connection, 'task /1', 'file-1')).resolves.toMatchObject({ task_id: 'task /1' })
    expect(fetchMock.mock.calls[0][0]).toBe(`${connection.apiHost}/v1/tasks/task%20%2F1`)
    for (const response of [
      { ...receipt('pending'), task_id: 'other' },
      { ...receipt('pending'), files: [{ file_id: 'other', status: 'pending' }] }
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json(response))
      await expect(getTasksParseTask(connection, 'task-1', 'file-1')).rejects.toThrow('invalid or unsupported response')
    }
  })
  it.each(['application/zip; charset=binary', 'application/octet-stream'])(
    'reads ZIP Markdown for %s',
    async (type) => {
      transferMock.mockResolvedValueOnce(new Response(zip(), { headers: { 'content-type': type } }))
      await expect(downloadTasksMarkdown(connection, '/result')).resolves.toBe('# exact\n')
    }
  )
  it.each([
    ['text/html', new TextEncoder().encode('<html>')],
    ['application/zip', new TextEncoder().encode('not zip')],
    ['application/zip', zip(false)]
  ])('rejects invalid result content %s', async (type, body) => {
    transferMock.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': type } }))
    await expect(downloadTasksMarkdown(connection, '/result')).rejects.toThrow()
  })
  it('rejects non-success and redirect without location', async () => {
    transferMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(downloadTasksMarkdown(connection, '/result')).rejects.toThrow('HTTP 503')
    transferMock.mockResolvedValueOnce(new Response(null, { status: 302 }))
    await expect(downloadTasksMarkdown(connection, '/result')).rejects.toThrow('invalid or unsupported response')
  })
  it('retains credentials through a same-origin redirect', async () => {
    transferMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/zip' } }))
    transferMock.mockResolvedValueOnce(new Response(zip(), { headers: { 'content-type': 'application/zip' } }))
    await expect(downloadTasksMarkdown(connection, '/result')).resolves.toBe('# exact\n')
    expect(transferMock.mock.calls.map(([, init]) => new Headers(init.headers).get('authorization'))).toEqual([
      'Bearer secret',
      'Bearer secret'
    ])
  })
  it('propagates cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(downloadTasksMarkdown(connection, '/result', controller.signal)).rejects.toThrow()
  })
})
