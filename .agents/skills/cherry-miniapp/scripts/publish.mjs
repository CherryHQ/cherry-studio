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
import { inflateRawSync } from 'node:zlib'

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex')

function assertManifestShape(manifest, origin) {
  if (typeof manifest.id !== 'string' || !manifest.id) throw new Error(`${origin}: missing id`)
  if (typeof manifest.version !== 'string' || !manifest.version) throw new Error(`${origin}: missing version`)
  if (manifest.package !== undefined) {
    throw new Error(`${origin}: the packaged manifest must not contain a \`package\` block`)
  }
  return manifest
}

async function readSourceManifest(appDir) {
  const raw = await fs.readFile(path.join(path.resolve(appDir), 'manifest.json'))
  return assertManifestShape(JSON.parse(raw.toString('utf8')), 'manifest.json')
}

/**
 * Minimal reader for ONE entry of the ZIP this skill's package.mjs writes
 * (stored or raw-deflate members, no data descriptors, no zip64).
 */
export function readZipEntry(zipBytes, entryName) {
  // End Of Central Directory: scan back from the end for its signature.
  let eocd = -1
  for (let i = zipBytes.length - 22; i >= Math.max(0, zipBytes.length - 22 - 65535); i--) {
    if (zipBytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a ZIP archive: no end-of-central-directory record')
  const count = zipBytes.readUInt16LE(eocd + 10)
  let offset = zipBytes.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (zipBytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt ZIP: bad central directory entry')
    const method = zipBytes.readUInt16LE(offset + 10)
    const compressedSize = zipBytes.readUInt32LE(offset + 20)
    const nameLen = zipBytes.readUInt16LE(offset + 28)
    const extraLen = zipBytes.readUInt16LE(offset + 30)
    const commentLen = zipBytes.readUInt16LE(offset + 32)
    const localOffset = zipBytes.readUInt32LE(offset + 42)
    const name = zipBytes.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    if (name === entryName) {
      if (zipBytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('corrupt ZIP: bad local header')
      const localNameLen = zipBytes.readUInt16LE(localOffset + 26)
      const localExtraLen = zipBytes.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      const data = zipBytes.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data)
      throw new Error(`unsupported ZIP compression method ${method} for ${entryName}`)
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`archive does not contain ${entryName}`)
}

/**
 * The identity the distribution metadata MUST serve: the manifest INSIDE the
 * final tested archive, not the source tree. Editing the source after packaging
 * must fail here — otherwise generation and verification would bless a manifest
 * whose version the hosted package does not carry.
 */
export async function expectedManifest(appDir, packageFile) {
  const packageBytes = await fs.readFile(path.resolve(packageFile))
  const archive = assertManifestShape(
    JSON.parse(readZipEntry(packageBytes, 'manifest.json').toString('utf8')),
    'manifest.json inside the package'
  )
  const source = await readSourceManifest(appDir)
  if (source.id !== archive.id || source.version !== archive.version) {
    throw new Error(
      `source manifest (${source.id}@${source.version}) diverges from the tested package ` +
        `(${archive.id}@${archive.version}); rebuild the package before publishing`
    )
  }
  return { manifest: archive, packageBytes }
}

/** The immutable hosted package path for one version of one app. */
export function hostedPackagePath(id, version) {
  return `apps/${id}/${version}/${id}-${version}.miniapp`
}

/** The ONE mutable path in the layout: always the latest distribution manifest. */
export function hostedManifestPath(id) {
  return `apps/${id}/manifest.json`
}

/** The hosted icon lives next to its package, at the same immutable versioned path. */
export function hostedIconPath(id, version, iconPath) {
  return `apps/${id}/${version}/${iconPath}`
}

/**
 * Build the hosted distribution manifest from the packaged manifest and the
 * final tested package bytes.
 */
export async function buildDistributionManifest(appDir, packageFile, baseUrl) {
  const { manifest, packageBytes } = await expectedManifest(appDir, packageFile)
  const base = baseUrl.replace(/\/+$/, '')
  if (!base.startsWith('https://')) throw new Error(`baseUrl must be an https:// origin: ${baseUrl}`)
  return {
    ...manifest,
    // REQUIRED by the hosted contract (MiniAppDistributionManifestSchema): without an
    // update endpoint a served manifest has nowhere to be checked against. The pointer
    // is the one mutable path in the layout — it always serves the LATEST manifest,
    // while package paths stay immutable per version.
    update: { url: `${base}/${hostedManifestPath(manifest.id)}` },
    package: {
      url: `${base}/${hostedPackagePath(manifest.id, manifest.version)}`,
      // Served next to the package at its immutable versioned path, so the consent
      // card can show the icon before downloading; the host verifies it against
      // icon.sha256, the same digest the packaged icon must match at install.
      ...(manifest.icon
        ? { iconUrl: `${base}/${hostedIconPath(manifest.id, manifest.version, manifest.icon.path)}` }
        : {}),
      sha256: sha256Hex(packageBytes),
      size: packageBytes.length
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

  const { manifest: expected, packageBytes } = await expectedManifest(appDir, packageFile)

  const hostedManifest = JSON.parse((await fetchNoRedirects(hostedManifestUrl)).toString('utf8'))
  if (hostedManifest.version !== expected.version) {
    throw new Error(
      `hosted version ${hostedManifest.version} does not match the tested package version ${expected.version}`
    )
  }
  if (hostedManifest.id !== expected.id) {
    throw new Error(`hosted id ${hostedManifest.id} does not match the tested package id ${expected.id}`)
  }

  // The hosted contract REQUIRES an update endpoint; a manifest without one is
  // rejected by the URL installer, so it must fail here first.
  const update = hostedManifest.update
  if (!update || typeof update.url !== 'string') {
    throw new Error('hosted manifest: missing update.url (required for any served manifest)')
  }
  assertSameOrigin(update.url, hostedManifestUrl, 'update.url')
  // Mirrors come in pairs: a package mirror with no update mirror (or vice versa)
  // is rejected by the hosted schema.
  if ((update.urlCn === undefined) !== (hostedManifest.package?.urlCn === undefined)) {
    throw new Error('hosted manifest: update.urlCn and package.urlCn must be declared together')
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

  // The HOSTED declarations are what the installer consumes: the hosted icon block
  // must equal the archived one, and the DECLARED hosted icon URL (package.iconUrl,
  // falling back to the icon path resolved against the manifest URL) is what gets
  // fetched and digest-checked. A hosted manifest that declares an iconUrl with no
  // icon block leaves nothing to verify it against — refuse it.
  if (pkg.iconUrl !== undefined && hostedManifest.icon === undefined) {
    throw new Error('hosted manifest: package.iconUrl declared without an icon block to verify it against')
  }
  if (expected.icon?.path) {
    if (hostedManifest.icon?.path !== expected.icon.path || hostedManifest.icon?.sha256 !== expected.icon.sha256) {
      throw new Error('hosted manifest icon block does not match the tested package icon')
    }
    const iconUrl = pkg.iconUrl ?? new URL(hostedManifest.icon.path, hostedManifestUrl).href
    assertSameOrigin(iconUrl, hostedManifestUrl, 'icon')
    const hostedIcon = await fetchNoRedirects(iconUrl)
    if (sha256Hex(hostedIcon) !== expected.icon.sha256) {
      throw new Error('hosted icon bytes do not match the manifest icon.sha256')
    }
  }

  return { ok: true, id: expected.id, version: expected.version, url: pkg.url }
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
