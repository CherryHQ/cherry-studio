import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterAll, describe, expect, it } from 'vitest'

// The skill ships zero-dependency scripts; import them directly by path.
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.agents/skills/cherry-miniapp')
const { packageApp } = await import(path.join(SKILL_DIR, 'scripts/package.mjs'))
const { buildDistributionManifest, verifyPublished, hostedPackagePath } = await import(
  path.join(SKILL_DIR, 'scripts/publish.mjs')
)
const { checkSubmissionFiles, checkDuplicateEntry } = await import(
  path.join(SKILL_DIR, 'scripts/check-directory-submission.mjs')
)

const execFileAsync = promisify(execFile)
const sha256Hex = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

const tempDirs: string[] = []
const servers: http.Server[] = []

async function makeTempDir(prefix = 'cherry-miniapp-publish-'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function copyTemplate(into?: string): Promise<string> {
  const dir = into ?? (await makeTempDir())
  await fs.cp(path.join(SKILL_DIR, 'assets/template'), dir, { recursive: true })
  return dir
}

type HostedFiles = Record<string, Buffer | { redirectTo: string }>

async function serveHostedFiles(files: HostedFiles): Promise<string> {
  const server = http.createServer((req, res) => {
    const entry = files[req.url ?? '']
    if (!entry) {
      res.writeHead(404).end('not found')
      return
    }
    if (!Buffer.isBuffer(entry)) {
      res.writeHead(302, { location: entry.redirectTo }).end()
      return
    }
    res.writeHead(200, { 'content-length': entry.length }).end(entry)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('no server address')
  return `http://127.0.0.1:${address.port}`
}

async function packageTemplate(): Promise<{ appDir: string; packageFile: string }> {
  const appDir = await copyTemplate()
  const packageFile = path.join(await makeTempDir(), 'app.miniapp')
  await packageApp(appDir, packageFile)
  return { appDir, packageFile }
}

describe('publish.mjs manifest', () => {
  it('builds the hosted manifest with the immutable package path and the tested package identity', async () => {
    const { appDir, packageFile } = await packageTemplate()
    const bytes = await fs.readFile(packageFile)
    const manifest = await buildDistributionManifest(appDir, packageFile, 'https://user.github.io/miniapps/')
    expect(manifest.package).toEqual({
      url: 'https://user.github.io/miniapps/apps/com.example.miniapp/1.0.0/com.example.miniapp-1.0.0.miniapp',
      sha256: sha256Hex(bytes),
      size: bytes.length
    })
    expect(manifest.version).toBe('1.0.0')
    expect(hostedPackagePath('com.example.miniapp', '2.0.0')).toBe(
      'apps/com.example.miniapp/2.0.0/com.example.miniapp-2.0.0.miniapp'
    )
  })

  it('rejects a packaged manifest that already carries a package block', async () => {
    const { appDir, packageFile } = await packageTemplate()
    const manifestPath = path.join(appDir, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.package = { url: 'https://x' }
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    await expect(buildDistributionManifest(appDir, packageFile, 'https://user.github.io/miniapps')).rejects.toThrow(
      /package/
    )
  })

  it('rejects a non-https base URL', async () => {
    const { appDir, packageFile } = await packageTemplate()
    await expect(buildDistributionManifest(appDir, packageFile, 'http://example.com')).rejects.toThrow(/https/)
  })

  it('runs as a CLI from a directory with spaces', async () => {
    const spaced = await makeTempDir('cherry miniapp publish ')
    const appDir = await copyTemplate(path.join(spaced, 'app dir'))
    const packageFile = path.join(spaced, 'app.miniapp')
    await packageApp(appDir, packageFile)
    const { stdout } = await execFileAsync('node', [
      path.join(SKILL_DIR, 'scripts/publish.mjs'),
      'manifest',
      appDir,
      packageFile,
      'https://user.github.io/miniapps'
    ])
    expect(JSON.parse(stdout).package.url).toContain('/apps/com.example.miniapp/1.0.0/')
  })
})

describe('publish.mjs verify (read-back gate)', () => {
  async function hostFor(appDir: string, packageFile: string, overrides: HostedFiles = {}) {
    const manifest = await buildDistributionManifest(appDir, packageFile, 'https://user.github.io/miniapps')
    const packageBytes = await fs.readFile(packageFile)
    const iconBytes = await fs.readFile(path.join(appDir, 'icon.svg'))
    const packagePath = new URL(manifest.package.url).pathname
    const files: HostedFiles = {
      '/manifest.json': Buffer.from(JSON.stringify(manifest)),
      [packagePath]: packageBytes,
      '/icon.svg': iconBytes,
      ...overrides
    }
    return { manifest, files }
  }

  it('accepts a publish whose manifest, package and icon match the tested package', async () => {
    const { appDir, packageFile } = await packageTemplate()
    const { manifest } = await hostFor(appDir, packageFile)
    const packagePath = new URL(manifest.package.url).pathname
    const packageBytes = await fs.readFile(packageFile)
    const iconBytes = await fs.readFile(path.join(appDir, 'icon.svg'))
    // The server's file map is captured per request, so mutate one shared map.
    const files: HostedFiles = {}
    const base = await serveHostedFiles(files)
    const hosted = { ...manifest, package: { ...manifest.package, url: `${base}${packagePath}` } }
    files['/apps/com.example.miniapp/1.0.0/manifest.json'] = Buffer.from(JSON.stringify(hosted))
    files[packagePath] = packageBytes
    files['/apps/com.example.miniapp/1.0.0/icon.svg'] = iconBytes
    const result = await verifyPublished(`${base}/apps/com.example.miniapp/1.0.0/manifest.json`, appDir, packageFile, {
      allowInsecureLocalhost: true
    })
    expect(result.ok).toBe(true)
    expect(result.version).toBe('1.0.0')
  })

  it('fails when the hosted package bytes do not match the manifest digest', async () => {
    const { appDir, packageFile } = await packageTemplate()
    const { manifest } = await hostFor(appDir, packageFile)
    const files: HostedFiles = { '/m/pkg.miniapp': Buffer.from('tampered bytes') }
    const base = await serveHostedFiles(files)
    const hosted = { ...manifest, package: { ...manifest.package, url: `${base}/m/pkg.miniapp` } }
    files['/m/manifest.json'] = Buffer.from(JSON.stringify(hosted))
    await expect(
      verifyPublished(`${base}/m/manifest.json`, appDir, packageFile, { allowInsecureLocalhost: true })
    ).rejects.toThrow(/digest|size/i)
  })

  it('fails on a redirect instead of following it', async () => {
    const { appDir, packageFile } = await packageTemplate()
    const base = await serveHostedFiles({
      '/manifest.json': { redirectTo: 'https://user.github.io/miniapps/manifest.json' }
    })
    await expect(
      verifyPublished(`${base}/manifest.json`, appDir, packageFile, { allowInsecureLocalhost: true })
    ).rejects.toThrow()
  })

  it('fails when package.url points at a different origin', async () => {
    const { appDir, packageFile } = await packageTemplate()
    const { manifest } = await hostFor(appDir, packageFile)
    const hosted = { ...manifest, package: { ...manifest.package, url: 'https://evil.example/x.miniapp' } }
    const base = await serveHostedFiles({ '/manifest.json': Buffer.from(JSON.stringify(hosted)) })
    await expect(
      verifyPublished(`${base}/manifest.json`, appDir, packageFile, { allowInsecureLocalhost: true })
    ).rejects.toThrow(/origin/)
  })

  it('fails when the hosted version differs from the tested package', async () => {
    const { appDir, packageFile } = await packageTemplate()
    const { manifest } = await hostFor(appDir, packageFile)
    const hosted = { ...manifest, version: '9.9.9' }
    const base = await serveHostedFiles({ '/manifest.json': Buffer.from(JSON.stringify(hosted)) })
    await expect(
      verifyPublished(`${base}/manifest.json`, appDir, packageFile, { allowInsecureLocalhost: true })
    ).rejects.toThrow(/version/)
  })

  it('refuses plain http for non-localhost hosts', async () => {
    const { appDir, packageFile } = await packageTemplate()
    await expect(verifyPublished('http://example.com/manifest.json', appDir, packageFile)).rejects.toThrow(/HTTPS/)
  })
})

describe('check-directory-submission.mjs (docs gate)', () => {
  it('accepts the bilingual entry-only change', () => {
    expect(checkSubmissionFiles(['README.md', 'README.zh-CN.md'])).toEqual({ ok: true, issues: [] })
  })

  it('rejects packages, build output and single-language submissions', () => {
    expect(checkSubmissionFiles(['README.md', 'README.zh-CN.md', 'apps/x.miniapp']).ok).toBe(false)
    expect(checkSubmissionFiles(['README.md']).ok).toBe(false)
    expect(checkSubmissionFiles(['README.zh-CN.md']).ok).toBe(false)
    expect(checkSubmissionFiles(['docs/README.md', 'README.zh-CN.md']).ok).toBe(false)
  })

  it('rejects an app id an existing entry already lists', async () => {
    const dir = await makeTempDir()
    const en = path.join(dir, 'README.md')
    const zh = path.join(dir, 'README.zh-CN.md')
    await fs.writeFile(en, '- com.example.miniapp — existing listing\n')
    await fs.writeFile(zh, '没有该应用\n')
    const dup = await checkDuplicateEntry('com.example.miniapp', [en, zh])
    expect(dup.ok).toBe(false)
    expect(dup.issues.join('\n')).toContain('README.md')
    const fresh = await checkDuplicateEntry('com.example.other', [en, zh])
    expect(fresh.ok).toBe(true)
  })

  it('runs as a CLI over --files', async () => {
    const { stdout } = await execFileAsync('node', [
      path.join(SKILL_DIR, 'scripts/check-directory-submission.mjs'),
      '--files',
      'README.md',
      'README.zh-CN.md'
    ])
    expect(JSON.parse(stdout).states).toEqual(['published', 'submitted', 'merged'])
    await expect(
      execFileAsync('node', [
        path.join(SKILL_DIR, 'scripts/check-directory-submission.mjs'),
        '--files',
        'README.md',
        'README.zh-CN.md',
        'dist/bundle.zip'
      ])
    ).rejects.toMatchObject({ code: 1 })
  })
})
