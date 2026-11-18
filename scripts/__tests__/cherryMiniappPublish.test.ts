import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

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

/** A plausible https publishing base: valid for the packager, never fetched for real. */
const BASE = 'https://user.github.io/miniapps'
const MANIFEST_PATH = '/apps/com.example.miniapp/manifest.json'
const PACKAGE_PATH = '/apps/com.example.miniapp/1.0.0/com.example.miniapp-1.0.0.miniapp'
const ICON_PATH = '/apps/com.example.miniapp/1.0.0/icon.png'

const tempDirs: string[] = []

async function makeTempDir(prefix = 'cherry-miniapp-publish-'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function copyTemplate(into?: string): Promise<string> {
  const dir = into ?? (await makeTempDir())
  await fs.cp(path.join(SKILL_DIR, 'assets/template'), dir, { recursive: true })
  return dir
}

/**
 * Hosted files keyed by FULL URL. verifyPublished fetches with `redirect:
 * 'error'`, which this stub mirrors: a redirect entry throws instead of being
 * followed, exactly as undici would.
 */
type HostedFiles = Record<string, Buffer | { redirectTo: string }>

function stubFetch(files: HostedFiles): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { redirect?: string }) => {
      const url = String(input)
      const entry = files[url]
      if (!entry) return new Response('not found', { status: 404 })
      if (!Buffer.isBuffer(entry)) {
        if (init?.redirect === 'error') throw new Error(`redirect to ${entry.redirectTo} refused`)
        return new Response(null, { status: 302, headers: { location: entry.redirectTo } })
      }
      return new Response(new Uint8Array(entry), { status: 200 })
    })
  )
}

/**
 * Package the template, optionally with the update endpoint established first —
 * the publishing contract requires the endpoint INSIDE the archive, so the
 * source manifest gains it before packaging, exactly as publishing.md directs.
 */
async function packageTemplate(update?: {
  url: string
  urlCn?: string
}): Promise<{ appDir: string; packageFile: string }> {
  const appDir = await copyTemplate()
  if (update) {
    const manifestPath = path.join(appDir, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.update = update
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  const packageFile = path.join(await makeTempDir(), 'app.miniapp')
  await packageApp(appDir, packageFile)
  return { appDir, packageFile }
}

/**
 * The hosted distribution manifest for a publish: the packaged manifest (its
 * update block included, exactly as generation preserves it) plus the package
 * block, addressed by full URL.
 */
async function hostedManifestFor(
  appDir: string,
  packageFile: string,
  urls: { manifest: string; package: string; icon: string }
) {
  const source = JSON.parse(await fs.readFile(path.join(appDir, 'manifest.json'), 'utf8'))
  const packageBytes = await fs.readFile(packageFile)
  return {
    ...source,
    update: { ...source.update, url: urls.manifest },
    package: {
      url: urls.package,
      iconUrl: urls.icon,
      sha256: sha256Hex(packageBytes),
      size: packageBytes.length
    }
  }
}

describe('publish.mjs manifest', () => {
  it('builds the hosted manifest with the immutable package path and the tested package identity', async () => {
    const { appDir, packageFile } = await packageTemplate({ url: `${BASE}${MANIFEST_PATH}` })
    const bytes = await fs.readFile(packageFile)
    const manifest = await buildDistributionManifest(appDir, packageFile, 'https://user.github.io/miniapps/')
    expect(manifest.update).toEqual({ url: `${BASE}${MANIFEST_PATH}` })
    expect(manifest.package).toEqual({
      url: `${BASE}${PACKAGE_PATH}`,
      iconUrl: `${BASE}${ICON_PATH}`,
      sha256: sha256Hex(bytes),
      size: bytes.length
    })
    expect(manifest.version).toBe('1.0.0')
    expect(hostedPackagePath('com.example.miniapp', '2.0.0')).toBe(
      'apps/com.example.miniapp/2.0.0/com.example.miniapp-2.0.0.miniapp'
    )
  })

  it('preserves an archived China-mirror endpoint verbatim and derives the paired package mirror', async () => {
    const update = {
      url: `${BASE}${MANIFEST_PATH}`,
      urlCn: 'https://cn-mirror.example/apps/com.example.miniapp/manifest.json'
    }
    const { appDir, packageFile } = await packageTemplate(update)
    const manifest = await buildDistributionManifest(appDir, packageFile, BASE)
    expect(manifest.update).toEqual(update)
    // The hosted schema refuses update.urlCn without package.urlCn: the builder
    // must emit a manifest its own verifier accepts.
    expect(manifest.package.urlCn).toBe(
      'https://cn-mirror.example/apps/com.example.miniapp/1.0.0/com.example.miniapp-1.0.0.miniapp'
    )
  })

  it('refuses a package whose archived manifest never established the update endpoint', async () => {
    const { appDir, packageFile } = await packageTemplate()
    await expect(buildDistributionManifest(appDir, packageFile, BASE)).rejects.toThrow(/update\.url/)
  })

  it('refuses an archived update endpoint that leaves the publishing origin', async () => {
    const { appDir, packageFile } = await packageTemplate({
      url: 'https://other.example/apps/com.example.miniapp/manifest.json'
    })
    await expect(buildDistributionManifest(appDir, packageFile, BASE)).rejects.toThrow(/origin/)
  })

  it('rejects a packaged manifest that already carries a package block', async () => {
    const { appDir, packageFile } = await packageTemplate()
    const manifestPath = path.join(appDir, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.package = { url: 'https://x' }
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    await expect(buildDistributionManifest(appDir, packageFile, BASE)).rejects.toThrow(/package/)
  })

  it('rejects a non-https base URL', async () => {
    const { appDir, packageFile } = await packageTemplate()
    await expect(buildDistributionManifest(appDir, packageFile, 'http://example.com')).rejects.toThrow(/https/)
  })

  it('runs as a CLI from a directory with spaces', async () => {
    const spaced = await makeTempDir('cherry miniapp publish ')
    const appDir = await copyTemplate(path.join(spaced, 'app dir'))
    const manifestPath = path.join(appDir, 'manifest.json')
    const source = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    source.update = { url: `${BASE}${MANIFEST_PATH}` }
    await fs.writeFile(manifestPath, `${JSON.stringify(source, null, 2)}\n`)
    const packageFile = path.join(spaced, 'app.miniapp')
    await packageApp(appDir, packageFile)
    const { stdout } = await execFileAsync('node', [
      path.join(SKILL_DIR, 'scripts/publish.mjs'),
      'manifest',
      appDir,
      packageFile,
      BASE
    ])
    expect(JSON.parse(stdout).package.url).toContain('/apps/com.example.miniapp/1.0.0/')
  })
})

describe('publish.mjs verify (read-back gate)', () => {
  it('accepts a publish whose manifest, package and icon match the tested package', async () => {
    const { appDir, packageFile } = await packageTemplate({ url: `${BASE}${MANIFEST_PATH}` })
    const hosted = await hostedManifestFor(appDir, packageFile, {
      manifest: `${BASE}${MANIFEST_PATH}`,
      package: `${BASE}${PACKAGE_PATH}`,
      icon: `${BASE}${ICON_PATH}`
    })
    stubFetch({
      [`${BASE}${MANIFEST_PATH}`]: Buffer.from(JSON.stringify(hosted)),
      [`${BASE}${PACKAGE_PATH}`]: await fs.readFile(packageFile),
      [`${BASE}${ICON_PATH}`]: await fs.readFile(path.join(appDir, 'icon.png'))
    })
    const result = await verifyPublished(`${BASE}${MANIFEST_PATH}`, appDir, packageFile)
    expect(result.ok).toBe(true)
    expect(result.version).toBe('1.0.0')
  })

  it('fails when the hosted update endpoint diverges from the archived one', async () => {
    const { appDir, packageFile } = await packageTemplate({ url: `${BASE}${MANIFEST_PATH}` })
    const hosted = await hostedManifestFor(appDir, packageFile, {
      manifest: `${BASE}/m/manifest.json`,
      package: `${BASE}/m/pkg.miniapp`,
      icon: `${BASE}/m/icon.png`
    })
    stubFetch({ [`${BASE}/m/manifest.json`]: Buffer.from(JSON.stringify(hosted)) })
    await expect(verifyPublished(`${BASE}/m/manifest.json`, appDir, packageFile)).rejects.toThrow(/diverges/)
  })

  it('fails when the hosted China-mirror endpoint diverges from the archived one', async () => {
    const { appDir, packageFile } = await packageTemplate({
      url: `${BASE}${MANIFEST_PATH}`,
      urlCn: `${BASE}/apps/com.example.miniapp/manifest.cn.json`
    })
    // The hosted manifest drops the archived mirror endpoint (and, per the
    // pairing rule, declares no package mirror either) — a silent mirror loss.
    const hosted = await hostedManifestFor(appDir, packageFile, {
      manifest: `${BASE}${MANIFEST_PATH}`,
      package: `${BASE}${PACKAGE_PATH}`,
      icon: `${BASE}${ICON_PATH}`
    })
    delete hosted.update.urlCn
    stubFetch({ [`${BASE}${MANIFEST_PATH}`]: Buffer.from(JSON.stringify(hosted)) })
    await expect(verifyPublished(`${BASE}${MANIFEST_PATH}`, appDir, packageFile)).rejects.toThrow(/urlCn/)
  })

  it('fails when the hosted package bytes do not match the manifest digest', async () => {
    const { appDir, packageFile } = await packageTemplate({ url: `${BASE}/m/manifest.json` })
    const hosted = await hostedManifestFor(appDir, packageFile, {
      manifest: `${BASE}/m/manifest.json`,
      package: `${BASE}/m/pkg.miniapp`,
      icon: `${BASE}/m/icon.png`
    })
    stubFetch({
      [`${BASE}/m/manifest.json`]: Buffer.from(JSON.stringify(hosted)),
      [`${BASE}/m/pkg.miniapp`]: Buffer.from('tampered bytes')
    })
    await expect(verifyPublished(`${BASE}/m/manifest.json`, appDir, packageFile)).rejects.toThrow(/digest|size/i)
  })

  it('fails on a redirect instead of following it', async () => {
    const { appDir, packageFile } = await packageTemplate({ url: `${BASE}/manifest.json` })
    stubFetch({ [`${BASE}/manifest.json`]: { redirectTo: `${BASE}/elsewhere/manifest.json` } })
    await expect(verifyPublished(`${BASE}/manifest.json`, appDir, packageFile)).rejects.toThrow()
  })

  it('fails when package.url points at a different origin', async () => {
    const { appDir, packageFile } = await packageTemplate({ url: `${BASE}/manifest.json` })
    const hosted = await hostedManifestFor(appDir, packageFile, {
      manifest: `${BASE}/manifest.json`,
      package: `${BASE}/pkg.miniapp`,
      icon: `${BASE}/icon.png`
    })
    hosted.package.url = 'https://evil.example/x.miniapp'
    stubFetch({ [`${BASE}/manifest.json`]: Buffer.from(JSON.stringify(hosted)) })
    await expect(verifyPublished(`${BASE}/manifest.json`, appDir, packageFile)).rejects.toThrow(/origin/)
  })

  it('fails when the hosted version differs from the tested package', async () => {
    const { appDir, packageFile } = await packageTemplate({ url: `${BASE}/manifest.json` })
    const hosted = await hostedManifestFor(appDir, packageFile, {
      manifest: `${BASE}/manifest.json`,
      package: `${BASE}/pkg.miniapp`,
      icon: `${BASE}/icon.png`
    })
    hosted.version = '9.9.9'
    stubFetch({ [`${BASE}/manifest.json`]: Buffer.from(JSON.stringify(hosted)) })
    await expect(verifyPublished(`${BASE}/manifest.json`, appDir, packageFile)).rejects.toThrow(/version/)
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
