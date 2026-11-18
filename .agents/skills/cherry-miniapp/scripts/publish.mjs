#!/usr/bin/env node
/**
 * Publishing helpers for a Cherry Studio Mini App.
 *
 * Usage:
 *   node scripts/publish.mjs manifest <appDir> <package.miniapp> <baseUrl> [--out <file>]
 *   node scripts/publish.mjs verify <hostedManifestUrl> <appDir> <package.miniapp> [--allow-insecure-localhost]
 *
 * `manifest` builds the HOSTED distribution manifest: the packaged manifest
 * (which must not contain a `package` block) plus `package.url`,
 * `package.sha256` and `package.size` taken from the final tested package
 * bytes on disk — never from a re-package after the fact. The package URL
 * follows the immutable path convention
 * `<baseUrl>/apps/<id>/<version>/<id>-<version>.miniapp`; a released path is
 * never overwritten, so a new version always lands at a new path.
 *
 * `verify` is the read-back gate: the hosted manifest, package and icon are
 * fetched over HTTPS from the SAME origin, following NO redirects, and the
 * hosted version, package digest/size and icon digest must match the final
 * tested package on disk. Any mismatch is a broken publish: the script exits
 * non-zero and the mismatch is reported.
 *
 * Publishing itself (the upload) is deliberately NOT automated here: it runs
 * only on explicit user request, as references/publishing.md requires. This
 * script only prepares the manifest and verifies a publish that happened.
 *
 * Zero dependencies, plain node >= 18.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex')

async function readPackagedManifest(appDir) {
  const raw = await fs.readFile(path.join(path.resolve(appDir), 'manifest.json'))
  const manifest = JSON.parse(raw.toString('utf8'))
  if (typeof manifest.id !== 'string' || !manifest.id) throw new Error('manifest.json: missing id')
  if (typeof manifest.version !== 'string' || !manifest.version) throw new Error('manifest.json: missing version')
  if (manifest.package !== undefined) {
    throw new Error('manifest.json: the packaged manifest must not contain a `package` block')
  }
  return manifest
}

/** The immutable hosted package path for one version of one app. */
export function hostedPackagePath(id, version) {
  return `apps/${id}/${version}/${id}-${version}.miniapp`
}

/**
 * Build the hosted distribution manifest from the packaged manifest and the
 * final tested package bytes.
 */
export async function buildDistributionManifest(appDir, packageFile, baseUrl) {
  const manifest = await readPackagedManifest(appDir)
  const bytes = await fs.readFile(path.resolve(packageFile))
  const base = baseUrl.replace(/\/+$/, '')
  if (!/^https:\/\//.test(base)) throw new Error(`baseUrl must be an https:// origin: ${baseUrl}`)
  return {
    ...manifest,
    package: {
      url: `${base}/${hostedPackagePath(manifest.id, manifest.version)}`,
      sha256: sha256Hex(bytes),
      size: bytes.length
    }
  }
}

/** Fetch without following any redirect; a redirect IS a failure. */
async function fetchNoRedirects(url) {
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function assertSameOrigin(resourceUrl, manifestUrl, label) {
  const a = new URL(resourceUrl)
  const b = new URL(manifestUrl)
  if (a.origin !== b.origin) {
    throw new Error(`${label} must be served from the manifest's origin (${b.origin}), got ${a.origin}`)
  }
}

/**
 * Read-back verification (references/publishing.md): hosted manifest, package
 * and icon over HTTPS from the same origin, no redirects, matching digest,
 * size and version against the final tested package.
 */
export async function verifyPublished(hostedManifestUrl, appDir, packageFile, { allowInsecureLocalhost = false } = {}) {
  const manifestOrigin = new URL(hostedManifestUrl)
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(manifestOrigin.hostname)
  if (manifestOrigin.protocol !== 'https:' && !(allowInsecureLocalhost && isLocalhost)) {
    throw new Error(`hosted manifest must be read over HTTPS: ${hostedManifestUrl}`)
  }

  const expectedManifest = await readPackagedManifest(appDir)
  const packageBytes = await fs.readFile(path.resolve(packageFile))

  const hostedManifest = JSON.parse((await fetchNoRedirects(hostedManifestUrl)).toString('utf8'))
  if (hostedManifest.version !== expectedManifest.version) {
    throw new Error(
      `hosted version ${hostedManifest.version} does not match the tested package version ${expectedManifest.version}`
    )
  }
  if (hostedManifest.id !== expectedManifest.id) {
    throw new Error(`hosted id ${hostedManifest.id} does not match the tested package id ${expectedManifest.id}`)
  }

  const pkg = hostedManifest.package
  if (!pkg || typeof pkg.url !== 'string' || typeof pkg.sha256 !== 'string' || typeof pkg.size !== 'number') {
    throw new Error('hosted manifest: missing package.url / package.sha256 / package.size')
  }
  assertSameOrigin(pkg.url, hostedManifestUrl, 'package.url')
  if (pkg.sha256 !== sha256Hex(packageBytes)) {
    throw new Error('hosted manifest package.sha256 does not match the tested package digest')
  }
  if (pkg.size !== packageBytes.length) {
    throw new Error(`hosted manifest package.size ${pkg.size} != tested package size ${packageBytes.length}`)
  }

  const hostedPackage = await fetchNoRedirects(pkg.url)
  if (sha256Hex(hostedPackage) !== pkg.sha256) {
    throw new Error('hosted package bytes do not match the manifest digest')
  }
  if (hostedPackage.length !== pkg.size) {
    throw new Error('hosted package byte count does not match the manifest size')
  }

  if (expectedManifest.icon?.path) {
    const iconUrl = new URL(expectedManifest.icon.path, hostedManifestUrl).href
    assertSameOrigin(iconUrl, hostedManifestUrl, 'icon')
    const hostedIcon = await fetchNoRedirects(iconUrl)
    if (sha256Hex(hostedIcon) !== expectedManifest.icon.sha256) {
      throw new Error('hosted icon bytes do not match the manifest icon.sha256')
    }
  }

  return { ok: true, id: expectedManifest.id, version: expectedManifest.version, url: pkg.url }
}

// argv[1] is a raw filesystem path, import.meta.url a file URL: comparing them
// directly skips the CLI entirely on Windows or in a directory with spaces.
// Normalize the argv side to a URL so the documented `node <script>` invocation
// always enters (and importing the module never does).
const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isCliEntry) {
  const [command, ...rest] = process.argv.slice(2)
  try {
    if (command === 'manifest') {
      const [appDir, packageFile, baseUrl, ...flags] = rest
      if (!appDir || !packageFile || !baseUrl) {
        console.error('Usage: node scripts/publish.mjs manifest <appDir> <package.miniapp> <baseUrl> [--out <file>]')
        process.exit(2)
      }
      const outIndex = flags.indexOf('--out')
      const manifest = await buildDistributionManifest(appDir, packageFile, baseUrl)
      const json = `${JSON.stringify(manifest, null, 2)}\n`
      if (outIndex >= 0 && flags[outIndex + 1]) await fs.writeFile(flags[outIndex + 1], json)
      else process.stdout.write(json)
    } else if (command === 'verify') {
      const [hostedManifestUrl, appDir, packageFile, ...flags] = rest
      if (!hostedManifestUrl || !appDir || !packageFile) {
        console.error(
          'Usage: node scripts/publish.mjs verify <hostedManifestUrl> <appDir> <package.miniapp> [--allow-insecure-localhost]'
        )
        process.exit(2)
      }
      const result = await verifyPublished(hostedManifestUrl, appDir, packageFile, {
        allowInsecureLocalhost: flags.includes('--allow-insecure-localhost')
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
    } else {
      console.error('Usage: node scripts/publish.mjs <manifest|verify> … (see the header comment for the full usage)')
      process.exit(2)
    }
  } catch (error) {
    console.error(`publish.mjs: ${error.message}`)
    process.exit(1)
  }
}
