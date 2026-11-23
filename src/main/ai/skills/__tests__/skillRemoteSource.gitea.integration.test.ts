import { execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { createServer, type Server } from 'node:https'
import { devNull, tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import type * as ProcessRunner from '@main/utils/processRunner'

const state = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  beforeFetch: undefined as (() => void) | undefined
}))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({ ...state.env }) }))
vi.mock('@main/utils/commandResolver', () => ({ findExecutableInEnv: async () => '/usr/bin/git' }))
vi.mock('@main/utils/processRunner', async (original) => {
  const actual = await original<typeof ProcessRunner>()
  return {
    ...actual,
    executeCommand: async (...args: Parameters<typeof actual.executeCommand>) => {
      if (args[1].includes('fetch') && state.beforeFetch) {
        const callback = state.beforeFetch
        state.beforeFetch = undefined
        callback()
      }
      return actual.executeCommand(...args)
    }
  }
})

import { SkillService } from '../SkillService'

/** Real HTTPS + git-http-backend fixture, no external host, token, URL rewrite or mocked Git response. */
describe.skipIf(process.platform !== 'linux')('Gitea smart HTTP installation integration', () => {
  setupTestDatabase()
  let root: string, source: string, bare: string, base: string, server: Server
  let authRequired = false
  const requests: Array<{ url: string; authorization?: string; cookie?: string; privateHeader?: string }> = []
  let restorePath: { mockRestore: () => void }

  function git(args: string[], cwd?: string): string {
    return execFileSync(
      '/usr/bin/git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      }
    ).trim()
  }
  async function commitBody(body: string): Promise<string> {
    await fs.writeFile(path.join(source, 'skills/writer/body.txt'), body)
    git(['add', '.'], source)
    git(['commit', '-qm', 'fixture change'], source)
    return git(['rev-parse', 'HEAD'], source)
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'gitea-http-integration-'))
    source = path.join(root, 'source')
    bare = path.join(root, 'repos/owner/repo.git')
    await fs.mkdir(path.join(source, 'skills/writer'), { recursive: true })
    await fs.mkdir(path.join(source, 'skills/other'), { recursive: true })
    await fs.writeFile(
      path.join(source, 'skills/writer/SKILL.md'),
      '---\nname: writer\ndescription: fixture skill\n---\nTest fixture\n'
    )
    await fs.writeFile(path.join(source, 'skills/other/SKILL.md'), '---\nname: other\n---\nOther skill\n')
    await fs.writeFile(path.join(source, 'README.md'), 'Not part of the installed skill\n')
    git(['init', '-q', '-b', 'feature/demo', source])
    await commitBody('observed commit\n')
    await fs.mkdir(path.dirname(bare), { recursive: true })
    git(['clone', '-q', '--bare', source, bare])
    git(['--git-dir', bare, 'config', 'uploadpack.allowFilter', 'true'])
    const keyPath = path.join(root, 'key.pem'),
      certPath = path.join(root, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1'
      ],
      { stdio: 'pipe' }
    )
    requests.length = 0
    authRequired = false
    state.beforeFetch = undefined
    server = createServer(
      { key: await fs.readFile(keyPath), cert: await fs.readFile(certPath) },
      (request, response) => {
        requests.push({
          url: request.url!,
          authorization: request.headers.authorization,
          cookie: request.headers.cookie,
          privateHeader: request.headers['x-private-sentinel']?.toString()
        })
        if (authRequired) {
          response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture"' })
          response.end('authentication required')
          return
        }
        const url = new URL(request.url!, 'https://127.0.0.1')
        const child = spawn('/usr/lib/git-core/git-http-backend', [], {
          env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: devNull,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_PROJECT_ROOT: path.join(root, 'repos'),
            GIT_HTTP_EXPORT_ALL: '1',
            PATH_INFO: url.pathname,
            QUERY_STRING: url.search.slice(1),
            REQUEST_METHOD: request.method!,
            CONTENT_TYPE: request.headers['content-type'] ?? '',
            CONTENT_LENGTH: request.headers['content-length'] ?? '',
            HTTP_GIT_PROTOCOL: request.headers['git-protocol']?.toString() ?? '',
            SERVER_PROTOCOL: 'HTTP/1.1',
            REMOTE_ADDR: '127.0.0.1',
            HTTPS: 'on'
          }
        })
        const chunks: Buffer[] = []
        child.stdout.on('data', (chunk) => chunks.push(chunk))
        child.stderr.resume()
        child.on('error', (error) => {
          response.writeHead(500)
          response.end(error.message)
        })
        child.on('close', () => {
          const output = Buffer.concat(chunks),
            split = output.indexOf('\r\n\r\n')
          if (split < 0) {
            response.writeHead(500)
            response.end('Invalid CGI response')
            return
          }
          const headers: Record<string, string> = {}
          let status = 200
          for (const line of output.subarray(0, split).toString().split('\r\n')) {
            const separator = line.indexOf(':')
            if (separator < 0) continue
            const name = line.slice(0, separator).toLowerCase(),
              value = line.slice(separator + 1).trim()
            if (name === 'status') status = Number.parseInt(value)
            else headers[name] = value
          }
          response.writeHead(status, headers)
          response.end(output.subarray(split + 4))
        })
        request.pipe(child.stdin)
      }
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `https://127.0.0.1:${(server.address() as { port: number }).port}`
    const home = path.join(root, 'inherited-home')
    await fs.mkdir(home)
    state.env = {
      ...process.env,
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      GIT_SSL_CAINFO: certPath
    } as Record<string, string>
    restorePath = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      const directory = path.join(
        root,
        key === 'feature.agents.skills'
          ? 'library'
          : key === 'feature.agents.claude.skills'
            ? 'mirror/skills'
            : key === 'feature.agents.skills.install.temp'
              ? 'temp'
              : key
      )
      return filename ? path.join(directory, filename) : directory
    })
  })
  afterEach(async () => {
    restorePath?.mockRestore()
    state.beforeFetch = undefined
    server?.closeAllConnections()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('installs only the named skill at the observed commit even if its slash-containing branch moves before fetch (AC3)', async () => {
    const observed = git(['--git-dir', bare, 'rev-parse', 'refs/heads/feature/demo'])
    const moved = await commitBody('newer commit, must not be installed\n')
    git(['push', '-q', bare, 'feature/demo'], source)
    git(['--git-dir', bare, 'update-ref', 'refs/heads/feature/demo', observed])
    state.beforeFetch = () => {
      git(['--git-dir', bare, 'update-ref', 'refs/heads/feature/demo', moved])
    }
    const service = new SkillService()
    const installed = await service.install({
      installSource: `gitea:${base}/owner/repo/raw/branch/feature/demo/skills/writer/SKILL.md`
    })
    expect(installed.folderName).toBe('writer')
    expect(installed.sourceUrl).toBe(`${base}/owner/repo/src/branch/feature/demo/skills/writer/SKILL.md`)
    expect(await fs.readFile(path.join(root, 'library/writer/body.txt'), 'utf8')).toBe('observed commit\n')
    expect(await fs.readdir(path.join(root, 'library'))).toEqual(['writer'])
    expect(await fs.readdir(path.join(root, 'library/writer'))).toEqual(['SKILL.md', 'body.txt'])
    expect(agentGlobalSkillService.getById(installed.id)?.contentHash).toBe(installed.contentHash)
    expect(await fs.readdir(path.join(root, 'temp'))).toEqual([])
    expect(requests.some((request) => request.url.includes('git-upload-pack'))).toBe(true)
    expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/feature/demo'])).toBe(moved)
  }, 30_000)

  it('rejects an authentication challenge without reading a helper, inherited headers/cookies or netrc, and cleans up (AC6)', async () => {
    authRequired = true
    const helper = path.join(root, 'credential-helper.sh'),
      marker = path.join(root, 'helper-was-read')
    await fs.writeFile(
      helper,
      `#!/bin/sh\nprintf called > '${marker}'\nprintf 'username=fixture\\npassword=sentinel\\n'\n`,
      { mode: 0o700 }
    )
    const home = state.env.HOME
    await fs.writeFile(
      path.join(home, '.gitconfig'),
      `[credential]\n helper = ${helper}\n[http]\n extraHeader = X-Private-Sentinel: must-not-be-sent\n cookieFile = ${path.join(home, 'cookies')}\n`
    )
    await fs.writeFile(path.join(home, '.netrc'), 'machine 127.0.0.1 login fixture password sentinel\n', {
      mode: 0o600
    })
    await fs.writeFile(path.join(home, 'cookies'), '127.0.0.1\tFALSE\t/\tTRUE\t2147483647\tprivate\tsentinel\n')
    Object.assign(state.env, {
      GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: 'Authorization: Basic c2VudGluZWw='
    })
    await expect(
      new SkillService().install({
        installSource: `gitea:${base}/owner/repo/src/branch/feature/demo/skills/writer/SKILL.md`
      })
    ).rejects.toThrow(/Username|authentication|Authentication|401/)
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => !request.authorization && !request.cookie && !request.privateHeader)).toBe(true)
    await expect(fs.access(marker)).rejects.toThrow()
    expect(agentGlobalSkillService.listAll()).toEqual([])
    expect(await fs.readdir(path.join(root, 'temp'))).toEqual([])
  }, 30_000)

  it('does not mistake a same-name tag or commit ID for a branch', async () => {
    git(['--git-dir', bare, 'tag', 'only-tag', 'feature/demo'])
    const service = new SkillService()
    for (const ref of ['only-tag', git(['--git-dir', bare, 'rev-parse', 'feature/demo'])]) {
      await expect(
        service.install({ installSource: `gitea:${base}/owner/repo/src/branch/${ref}/skills/writer/SKILL.md` })
      ).rejects.toThrow(/No branch or tag/)
    }
    expect(agentGlobalSkillService.listAll()).toEqual([])
    expect(await fs.readdir(path.join(root, 'temp'))).toEqual([])
  }, 30_000)

  it('rejects unsafe replacement content without changing the existing installed skill or catalog row (AC3 rollback)', async () => {
    const service = new SkillService(),
      installSource = `gitea:${base}/owner/repo/src/branch/feature/demo/skills/writer/SKILL.md`
    const installed = await service.install({ installSource })
    await fs.writeFile(path.join(source, 'skills/writer/BODY.txt'), 'case collision\n')
    await commitBody('unsafe replacement\n')
    git(['push', '-q', bare, 'feature/demo'], source)
    await expect(service.install({ installSource })).rejects.toThrow()
    expect(agentGlobalSkillService.getById(installed.id)?.contentHash).toBe(installed.contentHash)
    expect(await fs.readFile(path.join(root, 'library/writer/body.txt'), 'utf8')).toBe('observed commit\n')
    expect(await fs.readdir(path.join(root, 'temp'))).toEqual([])
  }, 30_000)
})
