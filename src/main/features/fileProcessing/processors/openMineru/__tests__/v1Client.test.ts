import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileInfo } from '@shared/types/file'

const { fetchMock, lookupMock, agents } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  lookupMock: vi.fn(),
  agents: [] as Array<{ options: any; destroyed: boolean }>
}))
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))
vi.mock('undici', () => ({
  Agent: class {
    destroyed = false
    constructor(public options: any) {
      agents.push(this)
    }
    async destroy() {
      this.destroyed = true
    }
  }
}))
vi.mock('electron', () => ({ net: { fetch: fetchMock }, app: { getLocale: () => 'en-US' } }))

import { downloadV1Markdown, getV1ParseJob, startV1Parse } from '../v1Client'

const connection = { apiHost: 'https://mineru.example.com', apiKey: 'secret' }
const queued = { job_id: 'job-1', status: 'queued', files: [{ status: 'queued' }] }
const completedUpload = { id: 'upload-1', status: 'completed', file: { id: 'input-1' } }
let dir: string
let file: FileInfo

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mineru-v1-'))
  const filePath = path.join(dir, 'document.pdf')
  await fs.writeFile(filePath, 'pdf-data')
  file = { path: filePath, name: 'document', ext: 'pdf', size: 8, mime: 'application/pdf' } as FileInfo
})
afterAll(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await fs.rm(dir, { recursive: true, force: true })
})
beforeEach(() => {
  vi.stubEnv('CHERRY_STUDIO_NODE_PROXY_RULES', undefined)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  lookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  agents.length = 0
})

describe('MinerU V1 upload and parse', () => {
  it.each([
    ['/v1/uploads/upload-1/content', 'Bearer secret'],
    ['https://storage.example.com/signed-upload', null],
    ['https://mineru.example.com:8443/upload', null]
  ])('uploads bytes to %s with only the appropriate credentials', async (uploadUrl, authorization) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: 'upload-1',
        status: 'pending',
        upload_url: uploadUrl,
        upload_method: 'PUT',
        upload_headers: { 'x-upload-signature': 'signed' }
      })
    )
    fetchMock.mockResolvedValueOnce(new Response(null))
    fetchMock.mockResolvedValueOnce(Response.json(completedUpload))
    fetchMock.mockResolvedValueOnce(Response.json(queued, { status: 202 }))

    expect(await startV1Parse(connection, file)).toBe('job-1')
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe(new URL(uploadUrl, `${connection.apiHost}/`).href)
    expect(new Headers(init.headers).get('Authorization')).toBe(authorization)
    expect(new Headers(init.headers).get('x-upload-signature')).toBe('signed')
    expect(await init.body.text()).toBe('pdf-data')
    expect(init.redirect).toBe('manual')
    expect(fetchMock.mock.calls[2][0]).toBe(`${connection.apiHost}/v1/uploads/upload-1/complete`)
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      files: [{ source: { type: 'file_id', file_id: 'input-1' }, page_range: 'all' }],
      output_formats: ['markdown']
    })
  })

  it.each(['docx', 'png'])('omits PDF-only page ranges when parsing %s files', async (ext) => {
    fetchMock.mockResolvedValueOnce(Response.json(completedUpload))
    fetchMock.mockResolvedValueOnce(Response.json(queued))
    await startV1Parse(connection, { ...file, ext })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      files: [{ source: { type: 'file_id', file_id: 'input-1' } }],
      output_formats: ['markdown']
    })
  })

  it('skips byte upload and completion when the service reuses a file', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(completedUpload))
    fetchMock.mockResolvedValueOnce(Response.json(queued))
    expect(await startV1Parse(connection, file)).toBe('job-1')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${connection.apiHost}/v1/uploads`,
      `${connection.apiHost}/v1/parse/jobs`
    ])
  })

  it.each([
    { id: 'upload-1', status: 'completed' },
    { id: 'upload-1', status: 'pending', upload_url: 'https://storage.example.com/upload', upload_method: 'POST' },
    { id: 'upload-1', status: 'pending', upload_url: 'file:///etc/passwd', upload_method: 'PUT' },
    { id: 'upload-1', status: 'expired' }
  ])('does not submit a parse job for an unusable upload', async (payload) => {
    fetchMock.mockResolvedValueOnce(Response.json(payload))
    await expect(startV1Parse(connection, file)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not follow a redirect while uploading a document', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: 'upload-1',
        status: 'pending',
        upload_url: '/upload',
        upload_method: 'PUT'
      })
    )
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 307, headers: { location: 'https://other.example.com' } })
    )
    await expect(startV1Parse(connection, file)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('MinerU V1 result download', () => {
  it('keeps credentials for same-origin redirects and removes them permanently after a cross-origin hop', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/download' } }))
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/md' } })
    )
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: `${connection.apiHost}/return` } })
    )
    fetchMock.mockResolvedValueOnce(
      new Response('# parsed', { headers: { 'content-type': 'application/octet-stream' } })
    )
    expect(await downloadV1Markdown(connection, 'output-1')).toBe('# parsed')
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get('Authorization'))).toEqual([
      'Bearer secret',
      'Bearer secret',
      null,
      null
    ])
  })

  it('does not send the API key to another port on the same public host', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://mineru.example.com:8443/md' } })
    )
    fetchMock.mockResolvedValueOnce(new Response('# parsed'))
    expect(await downloadV1Markdown(connection, 'output-1')).toBe('# parsed')
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBeNull()
  })

  it('rejects redirects to an unrelated private address', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9999/admin' } })
    )
    await expect(downloadV1Markdown(connection, 'output-1')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('bounds redirect loops', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } }))
    await expect(downloadV1Markdown(connection, 'output-1')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('does not accept a proxy HTML login page as Markdown', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }))
    await expect(downloadV1Markdown(connection, 'output-1')).rejects.toThrow()
  })

  it('rejects a response belonging to a different parse job', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...queued, job_id: 'another-job' }))
    await expect(getV1ParseJob(connection, 'job-1')).rejects.toThrow()
  })
})

describe('MinerU V1 transfer safety', () => {
  it('uploads to and downloads from same-port loopback aliases', async () => {
    const localConnection = { apiHost: 'http://localhost:18000' }
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: 'upload-1',
        status: 'pending',
        upload_url: 'http://127.0.0.1:18000/upload',
        upload_method: 'PUT'
      })
    )
    fetchMock.mockResolvedValueOnce(new Response(null))
    fetchMock.mockResolvedValueOnce(Response.json(completedUpload))
    fetchMock.mockResolvedValueOnce(Response.json(queued))
    expect(await startV1Parse(localConnection, file)).toBe('job-1')
    expect(await fetchMock.mock.calls[1][1].body.text()).toBe('pdf-data')

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:18000/md' } })
    )
    fetchMock.mockResolvedValueOnce(new Response('# local result'))
    expect(await downloadV1Markdown(localConnection, 'output-1')).toBe('# local result')
  })

  it('blocks an upload hostname resolving to a private address before sending document bytes', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: 'upload-1',
        status: 'pending',
        upload_url: 'https://storage.example.com/upload',
        upload_method: 'PUT'
      })
    )
    await expect(startV1Parse(connection, file)).rejects.toThrow('DNS resolved to local or private address')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${connection.apiHost}/v1/uploads`])
    expect(agents).toHaveLength(0)
  })

  it('blocks a download redirect resolving to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/md' } })
    )
    await expect(downloadV1Markdown(connection, 'output-1')).rejects.toThrow('DNS resolved to local or private address')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${connection.apiHost}/v1/files/output-1/content`])
  })

  it('pins upload connections to the validated DNS answer while preserving the TLS hostname', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: 'upload-1',
        status: 'pending',
        upload_url: 'https://storage.example.com/upload',
        upload_method: 'PUT'
      })
    )
    fetchMock.mockImplementationOnce(async (url, init) => {
      expect(url).toBe('https://storage.example.com/upload')
      lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
      const lookup = init.dispatcher.options.connect.lookup
      expect(
        await new Promise((resolve) =>
          lookup('storage.example.com', {}, (_error: unknown, address: string, family: number) =>
            resolve({ address, family })
          )
        )
      ).toEqual({ address: '93.184.216.34', family: 4 })
      expect(
        await new Promise((resolve) =>
          lookup('storage.example.com', { all: true }, (_error: unknown, addresses: unknown) => resolve(addresses))
        )
      ).toEqual([{ address: '93.184.216.34', family: 4 }])
      expect(await init.body.text()).toBe('pdf-data')
      return new Response(null)
    })
    fetchMock.mockResolvedValueOnce(Response.json(completedUpload))
    fetchMock.mockResolvedValueOnce(Response.json(queued))
    expect(await startV1Parse(connection, file)).toBe('job-1')
    expect(lookupMock).toHaveBeenCalledTimes(1)
    expect(agents.every((agent) => agent.destroyed)).toBe(true)
  })

  it('revalidates DNS on each cross-origin download hop and releases failed transfers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/first' } })
    )
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/second' } }))
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '192.168.1.1', family: 4 }])
    await expect(downloadV1Markdown(connection, 'output-1')).rejects.toThrow('DNS resolved to local or private address')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(agents.every((agent) => agent.destroyed)).toBe(true)
  })

  it('destroys the pinned dispatcher when a transfer aborts before receiving headers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/md' } })
    )
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
    await expect(downloadV1Markdown(connection, 'output-1')).rejects.toThrow('aborted')
    expect(agents.every((agent) => agent.destroyed)).toBe(true)
  })

  it('still permits the explicitly configured local server', async () => {
    fetchMock.mockResolvedValueOnce(new Response('# local result'))
    expect(await downloadV1Markdown({ apiHost: 'http://127.0.0.1:18000' }, 'output-1')).toBe('# local result')
    expect(lookupMock).not.toHaveBeenCalled()
  })
})
