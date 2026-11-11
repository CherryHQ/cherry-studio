import type * as FsModule from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { FileInfoSchema } from '@shared/types/file'

const { fetchMock, openMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), openMock: vi.fn() }))
vi.mock('electron', () => ({ app: { getLocale: () => 'en-US' }, net: { fetch: fetchMock } }))
vi.mock('node:fs', async (original) => ({ ...(await original<typeof FsModule>()), openAsBlob: openMock }))

import { jinaDocumentToMarkdownHandler } from '../handler'

const config: FileProcessorMerged = {
  id: 'jina',
  type: 'api',
  apiKeys: ['secret-key'],
  capabilities: [
    {
      feature: 'document_to_markdown',
      inputs: ['document'],
      output: 'markdown',
      apiHost: ' https://custom.example/// '
    }
  ]
}
function file(ext: string | null = 'pdf', name = 'input') {
  return FileInfoSchema.parse({
    path: '/tmp/input',
    name,
    size: 4,
    ext,
    mime: 'application/pdf',
    type: 'document',
    createdAt: 1,
    modifiedAt: 1
  })
}
async function run(ext = 'pdf', name = 'input', signal = new AbortController().signal) {
  const task = await jinaDocumentToMarkdownHandler.prepare(file(ext, name), config)
  if (task.mode !== 'background') throw new Error('Expected background task')
  return task.execute({ signal, reportProgress: vi.fn() })
}
const success = (content: unknown) =>
  JSON.stringify({ code: 200, status: 20000, data: { content }, meta: { extra: true } })

describe('Jina document processing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openMock.mockResolvedValue(new Blob(['data'], { type: 'application/pdf' }))
    fetchMock.mockResolvedValue(new Response(success('  text\n'), { status: 200 }))
  })
  it.each(['pdf', 'docx', 'xlsx', 'pptx', 'PDF'])('uploads one %s file and preserves markdown', async (ext) => {
    const signal = new AbortController().signal
    expect(await run(ext, '季度报告.v1', signal)).toEqual({ kind: 'markdown', markdownContent: '  text\n' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://custom.example/')
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { Accept: 'application/json', Authorization: 'Bearer secret-key' }
    })
    expect(Object.keys(init.headers)).toHaveLength(2)
    const parts = [...init.body.entries()]
    expect(parts).toHaveLength(1)
    expect(parts[0][0]).toBe('file')
    expect(parts[0][1].name).toBe(`季度报告.v1.${ext}`)
    expect(await parts[0][1].text()).toBe('data')
  })
  it.each(['doc', 'xls', 'odt', 'odp', 'ods', 'unknown', null])(
    'rejects unsupported extension %s before upload',
    async (ext) => {
      expect(() => jinaDocumentToMarkdownHandler.prepare(file(ext), config)).toThrow('Jina supports only PDF')
      expect(openMock).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
  it.each(['', ' \n'])('rejects empty content', async (content) => {
    fetchMock.mockResolvedValue(new Response(success(content)))
    await expect(run()).rejects.toThrow('Jina returned empty Markdown content')
  })
  it('accepts a single character', async () => {
    fetchMock.mockResolvedValue(new Response(success('A')))
    expect(await run()).toEqual({ kind: 'markdown', markdownContent: 'A' })
  })
  it.each([
    [401, JSON.stringify({ message: 'Invalid API key, please get a new one from https://jina.ai' }), 'Invalid API key'],
    [403, JSON.stringify({ message: 'Abuse blocked' }), 'Abuse blocked'],
    [429, JSON.stringify({ readableMessage: 'Rate limited' }), 'Rate limited'],
    [500, 'server down', 'server down'],
    [401, '', 'HTTP 401']
  ])('reports HTTP %s details', async (status, body, detail) => {
    fetchMock.mockResolvedValue(new Response(body, { status }))
    await expect(run()).rejects.toThrow(detail)
  })
  it('redacts echoed credentials', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'secret-key rejected' }), { status: 401 }))
    await expect(run()).rejects.toThrow('<redacted>')
  })
  it.each([
    JSON.stringify({ code: 401, status: 40102, data: { content: 'A' } }),
    JSON.stringify({ code: 200, status: 1, data: { content: 'A' } })
  ])('rejects application errors', async (body) => {
    fetchMock.mockResolvedValue(new Response(body))
    await expect(run()).rejects.toThrow('Jina request failed (code')
  })
  it('includes provider details in application errors', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 401,
          status: 40102,
          data: null,
          message: 'Invalid API key, please get a new one from https://jina.ai'
        }),
        { status: 200 }
      )
    )
    await expect(run()).rejects.toThrow(/Jina request failed \(code 401, status 40102\): Invalid API key/)
  })
  it('omits the detail separator in application errors without provider details', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 401, status: 40102, data: null }), { status: 200 }))
    await expect(run()).rejects.toThrow(/Jina request failed \(code 401, status 40102\)$/)
  })
  it('redacts echoed credentials in application errors', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 401, status: 40102, data: null, message: 'secret-key rejected' }), {
        status: 200
      })
    )
    const result = run()
    await expect(result).rejects.toThrow('<redacted>')
    await expect(result).rejects.not.toThrow('secret-key')
  })
  it.each([
    'bad json',
    JSON.stringify({ data: { content: 'A' } }),
    JSON.stringify({ code: 200, status: 20000, data: null }),
    success(123)
  ])('rejects invalid response', async (body) => {
    fetchMock.mockResolvedValue(new Response(body))
    await expect(run()).rejects.toThrow('Jina returned an invalid response.')
  })
  it('validates credentials and honors cancellation', async () => {
    expect(() => jinaDocumentToMarkdownHandler.prepare(file(), { ...config, apiKeys: [] })).toThrow(
      'API key is required'
    )
    expect(() =>
      jinaDocumentToMarkdownHandler.prepare(file(), {
        ...config,
        capabilities: [{ ...config.capabilities[0], apiHost: '' }]
      })
    ).toThrow('API host is required')
    const controller = new AbortController()
    controller.abort()
    await expect(run('pdf', 'input', controller.signal)).rejects.toThrow()
    expect(openMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
