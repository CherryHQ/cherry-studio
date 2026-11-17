import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FileInfo } from '@shared/types/file'

const { fixture } = vi.hoisted(() => ({ fixture: { dir: '' } }))
vi.mock('electron', () => ({
  net: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) },
  app: { getLocale: () => 'en-US' }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  return { ...mock, application: { ...mock.application, getPath: () => fixture.dir } }
})

import { probeOpenMineru } from '../protocol'
import { downloadTasksMarkdown, getTasksParseTask, startTasksParse } from '../tasksClient'

let server: http.Server | undefined
let dir = ''
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())))
  server = undefined
  if (dir) await fs.rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('Tasks real HTTP', () => {
  it.each([
    ['', false],
    ['/proxy', false],
    ['', true]
  ])('runs through prefix %s and redirect %s', async (prefix, redirect) => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-wire-'))
    fixture.dir = dir
    const filePath = path.join(dir, 'document.pdf')
    await fs.writeFile(filePath, 'real PDF bytes')
    const file = {
      path: filePath,
      name: 'document',
      ext: 'pdf',
      size: (await fs.stat(filePath)).size,
      mime: 'application/pdf'
    } as FileInfo
    const requests: string[] = []
    let manifest: any
    let uploaded = Buffer.alloc(0)
    let uploadHeaders: http.IncomingHttpHeaders = {}
    let polls = 0
    const archive = new AdmZip()
    archive.addFile('markdown.md', Buffer.from('# streamed result\n'))
    const zip = archive.toBuffer()
    server = http.createServer(async (req, res) => {
      const url = req.url ?? ''
      requests.push(`${req.method} ${url}`)
      const parts: Buffer[] = []
      for await (const part of req) parts.push(Buffer.from(part))
      const body = Buffer.concat(parts)
      const json = (data: object, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      if (url === `${prefix}/v1/health`)
        return json({
          status: 'ok',
          version: '4.1.3',
          features: {
            sources: ['upload', 'url'],
            task_output_formats: ['default', 'docx', 'html', 'latex'],
            webhook: false
          }
        })
      if (url === `${prefix}/v1/tasks` && req.method === 'POST') {
        manifest = JSON.parse(body.toString())
        return json(
          {
            task_id: 'task-1',
            status: 'waiting-file',
            files: [
              {
                file_id: 'file-1',
                status: 'waiting-file',
                upload: { url: `${prefix}/v1/upload`, headers: { 'x-upload': 'signed' } }
              }
            ]
          },
          202
        )
      }
      if (url === `${prefix}/v1/upload` && req.method === 'PUT') {
        uploaded = body
        uploadHeaders = req.headers
        res.writeHead(204)
        return res.end()
      }
      if (url === `${prefix}/v1/tasks/task-1`) {
        const status = ['pending', 'running', 'completed'][polls++]
        return json({
          task_id: 'task-1',
          status,
          files: [
            { file_id: 'file-1', status, ...(status === 'completed' ? { result_url: `${prefix}/v1/result` } : {}) }
          ]
        })
      }
      if (url === `${prefix}/v1/result` && redirect) {
        res.writeHead(302, { location: `${prefix}/v1/zip` })
        return res.end()
      }
      if (url === `${prefix}/v1/result` || url === `${prefix}/v1/zip`) {
        res.writeHead(200, { 'content-type': 'application/zip; charset=binary' })
        const third = Math.ceil(zip.length / 3)
        res.write(zip.subarray(0, third))
        res.write(zip.subarray(third, third * 2))
        res.end(zip.subarray(third * 2))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No TCP address')
    const connection = { apiHost: `http://127.0.0.1:${address.port}${prefix}`, apiKey: 'secret' }
    expect(await probeOpenMineru(connection)).toEqual({ kind: 'supported', protocol: 'tasks' })
    expect(await startTasksParse(connection, file)).toEqual({ taskId: 'task-1', fileId: 'file-1' })
    for (const status of ['pending', 'running', 'completed'])
      expect((await getTasksParseTask(connection, 'task-1', 'file-1')).status).toBe(status)
    expect(await downloadTasksMarkdown(connection, `${prefix}/v1/result`)).toBe('# streamed result\n')
    expect(uploaded.toString()).toBe('real PDF bytes')
    expect(uploaded.length).toBe(file.size)
    expect(manifest.files[0].bytes).toBe(uploaded.length)
    expect(uploadHeaders.authorization).toBe('Bearer secret')
    expect(uploadHeaders['x-upload']).toBe('signed')
    expect(requests).toEqual([
      `GET ${prefix}/v1/health`,
      `POST ${prefix}/v1/tasks`,
      `PUT ${prefix}/v1/upload`,
      ...Array(3).fill(`GET ${prefix}/v1/tasks/task-1`),
      `GET ${prefix}/v1/result`,
      ...(redirect ? [`GET ${prefix}/v1/zip`] : [])
    ])
  })
})
