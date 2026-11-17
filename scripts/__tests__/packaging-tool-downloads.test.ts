import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type BundledTool, prepareTools } from '../download-binaries'

let directory: string
let server: http.Server
let baseUrl: string
let requests: string[]
let respond: (request: http.IncomingMessage, response: http.ServerResponse) => void

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-tools-'))
  requests = []
  respond = (request, response) => response.end(`payload:${request.url}`)
  server = http.createServer((request, response) => {
    requests.push(request.url ?? '')
    respond(request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected an HTTP listener')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(directory, { recursive: true, force: true })
})

function tool(name: string): BundledTool {
  return {
    name,
    version: '1.0.0',
    versionFile: `.${name}-version`,
    required: true,
    packages: {
      'test-x64': {
        url: `${baseUrl}/${name}`,
        archive: 'none',
        binaries: [name],
        sha256: crypto.createHash('sha256').update(`payload:/${name}`).digest('hex')
      }
    }
  }
}

function options(name: string, tools = [tool('one')]) {
  return {
    tools,
    resourcesDir: path.join(directory, name),
    cacheDir: path.join(directory, 'cache')
  }
}

function binary(resources: string, name: string) {
  return path.join(directory, resources, 'test-x64', name)
}

describe('packaging tool assets', () => {
  it('prepares a new bundle offline and never writes output changes back to the cache', async () => {
    await prepareTools('test', 'x64', options('first'))
    expect(fs.readFileSync(binary('first', 'one'), 'utf8')).toBe('payload:/one')
    fs.writeFileSync(binary('first', 'one'), 'modified packaged executable')
    await new Promise<void>((resolve) => server.close(() => resolve()))

    await prepareTools('test', 'x64', options('second'))
    expect(fs.readFileSync(binary('second', 'one'), 'utf8')).toBe('payload:/one')
    expect(requests).toEqual(['/one'])
  })

  it('repairs a corrupt original asset instead of trusting the cache filename', async () => {
    const first = tool('one')
    await prepareTools('test', 'x64', options('first', [first]))
    const blob = path.join(directory, 'cache', 'complete', first.packages['test-x64'].sha256)
    fs.writeFileSync(blob, 'corrupt')

    await prepareTools('test', 'x64', options('second', [first]))
    expect(requests).toEqual(['/one', '/one'])
    expect(fs.readFileSync(binary('second', 'one'), 'utf8')).toBe('payload:/one')
  })

  it('does not reuse an asset when its pinned digest changes', async () => {
    await prepareTools('test', 'x64', options('first'))
    const updated = tool('one')
    updated.version = '2.0.0'
    updated.packages['test-x64'].sha256 = crypto.createHash('sha256').update('new version').digest('hex')
    respond = (_request, response) => response.end('new version')

    await prepareTools('test', 'x64', options('second', [updated]))
    expect(fs.readFileSync(binary('second', 'one'), 'utf8')).toBe('new version')
    expect(fs.readFileSync(binary('second', '.one-version'), 'utf8')).toBe('2.0.0')
    expect(requests).toHaveLength(2)
  })

  it('overlaps real cold downloads while limiting active requests to three', async () => {
    let active = 0
    let maximum = 0
    respond = (request, response) => {
      active += 1
      maximum = Math.max(maximum, active)
      setTimeout(() => {
        active -= 1
        response.end(`payload:${request.url}`)
      }, 30)
    }
    const tools = ['one', 'two', 'three', 'four', 'five'].map(tool)
    await prepareTools('test', 'x64', options('bundle', tools))

    expect(maximum).toBe(3)
    expect(active).toBe(0)
    for (const item of tools) {
      expect(fs.readFileSync(binary('bundle', item.name), 'utf8')).toBe(`payload:/${item.name}`)
      expect(fs.readFileSync(binary('bundle', item.versionFile), 'utf8')).toBe(item.version)
    }
  })

  it('settles other transfers before reporting a bad asset and never caches the bad bytes', async () => {
    let finished = false
    respond = (request, response) => {
      if (request.url === '/bad') response.end('wrong payload')
      else
        setTimeout(() => {
          finished = true
          response.end(`payload:${request.url}`)
        }, 40)
    }
    const bad = tool('bad')
    await expect(prepareTools('test', 'x64', options('bundle', [bad, tool('good')]))).rejects.toThrow()
    expect(finished).toBe(true)
    expect(fs.existsSync(path.join(directory, 'cache', 'complete', bad.packages['test-x64'].sha256))).toBe(false)
    expect(fs.existsSync(binary('bundle', '.bad-version'))).toBe(false)
  })

  it('isolates simultaneous invocations publishing the same original asset', async () => {
    await Promise.all([prepareTools('test', 'x64', options('first')), prepareTools('test', 'x64', options('second'))])
    expect(fs.readFileSync(binary('first', 'one'), 'utf8')).toBe('payload:/one')
    expect(fs.readFileSync(binary('second', 'one'), 'utf8')).toBe('payload:/one')
    expect(fs.readdirSync(path.join(directory, 'cache', 'complete'))).toHaveLength(1)
  })

  it('prepares a real archive offline without sharing mutable extracted files', async () => {
    const payload = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/mingit-tree.zip'))
    const archived: BundledTool = {
      ...tool('git'),
      packages: {
        'test-x64': {
          url: `${baseUrl}/archive`,
          archive: 'zip-tree',
          dir: 'git',
          binaries: ['git/cmd/git.txt'],
          sha256: crypto.createHash('sha256').update(payload).digest('hex')
        }
      }
    }
    respond = (_request, response) => response.end(payload)
    await prepareTools('test', 'x64', { ...options('first'), tools: [archived] })
    fs.writeFileSync(binary('first', 'git/cmd/git.txt'), 'modified output')
    await new Promise<void>((resolve) => server.close(() => resolve()))

    await prepareTools('test', 'x64', { ...options('second'), tools: [archived] })
    expect(fs.readFileSync(binary('second', 'git/cmd/git.txt'), 'utf8')).toBe('fake git launcher\n')
    expect(fs.existsSync(binary('second', 'git/mingw64/bin/tool.txt'))).toBe(true)
  })

  it('falls back to verified downloads when the configured cache is unusable', async () => {
    const cacheDir = path.join(directory, 'not-a-directory')
    fs.writeFileSync(cacheDir, 'occupied')
    await prepareTools('test', 'x64', { ...options('bundle'), cacheDir })
    expect(fs.readFileSync(binary('bundle', 'one'), 'utf8')).toBe('payload:/one')
  })

  it('cleans old staging even when the prepared output is already current', async () => {
    await prepareTools('test', 'x64', options('bundle'))
    const sourceRoot = path.resolve(import.meta.dirname, '../..')
    const owner = crypto.createHash('sha256').update(sourceRoot).digest('hex').slice(0, 8)
    const stale = binary('bundle', `.staging-${owner}/one`)
    fs.mkdirSync(stale, { recursive: true })
    fs.writeFileSync(path.join(stale, 'partial'), 'old failed attempt')

    await prepareTools('test', 'x64', options('bundle'))
    expect(fs.existsSync(stale)).toBe(false)
    expect(requests).toHaveLength(1)
  })

  it('resumes an interrupted transfer and falls back when the server refuses Range', async () => {
    const ranges: string[] = []
    respond = (request, response) => {
      response.setHeader('Content-Length', 12)
      response.setHeader('Connection', 'close')
      response.end(`payload:${request.url}`.slice(0, 6))
    }
    await expect(prepareTools('test', 'x64', options('first'))).rejects.toThrow()
    respond = (request, response) => {
      ranges.push(request.headers.range ?? '')
      const payload = `payload:${request.url}`
      const offset = Number(request.headers.range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0)
      response.writeHead(offset ? 206 : 200, {
        'Content-Length': payload.length - offset,
        ...(offset ? { 'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}` } : {})
      })
      response.end(payload.slice(offset))
    }
    await prepareTools('test', 'x64', options('second'))
    expect(ranges).toContain('bytes=6-')
    expect(fs.readFileSync(binary('second', 'one'), 'utf8')).toBe('payload:/one')

    respond = (request, response) => {
      response.setHeader('Content-Length', 12)
      response.setHeader('Connection', 'close')
      response.end(`payload:${request.url}`.slice(0, 6))
    }
    await expect(prepareTools('test', 'x64', options('third', [tool('two')]))).rejects.toThrow()
    let ignoredRange = false
    respond = (request, response) => {
      if (request.headers.range) ignoredRange = true
      response.end(`payload:${request.url}`)
    }
    await prepareTools('test', 'x64', options('fourth', [tool('two')]))
    expect(ignoredRange).toBe(true)
    expect(fs.readFileSync(binary('fourth', 'two'), 'utf8')).toBe('payload:/two')
  }, 40_000)
})
