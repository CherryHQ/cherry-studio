#!/usr/bin/env node
/**
 * Authoring-time validator for a Cherry Studio Mini App directory.
 *
 * Usage: node scripts/validate.mjs <appDir>
 *
 * Mirrors the packaged contract in src/shared/types/miniAppManifest.ts
 * (see references/contract.md). The host re-validates authoritatively at
 * install; this script exists so authoring loops fail fast. Zero
 * dependencies, plain node >= 18.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_ICON_BYTES = 5 * 1024 * 1024
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 10 }, (_, i) => `com${i}`),
  ...Array.from({ length: 10 }, (_, i) => `lpt${i}`)
])
const PERMISSIONS = [
  'ai.chat',
  'clipboard.read',
  'clipboard.write',
  'file.delete',
  'file.export',
  'file.list',
  'file.load',
  'file.save',
  'network.fetch',
  'notification.show',
  'storage.delete',
  'storage.get',
  'storage.keys',
  'storage.set'
]
const NAMESPACES = [...new Set(PERMISSIONS.map((p) => p.split('.')[0]))]
const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const SHA256_RE = /^[a-f0-9]{64}$/
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-((0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(\+([0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*))?$/
const DEV_SERVER_RE = /(?:https?|ws):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/i
const TEXT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.md',
  '.xml'
])

function checkRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1) return 'must be a non-empty string'
  if (value.startsWith('/') || value.includes('\\')) return 'must be a package-relative POSIX path'
  if (value.split('/').includes('..')) return 'must not traverse outside the package'
  if (value.split('/')[0] === '__cherry') return "must not use the reserved '__cherry' directory"
  return null
}

function checkLocalized(value, max, field, issues) {
  const one = (v, at) => {
    if (typeof v !== 'string' || v.length < 1 || v.length > max) {
      issues.push(`${field}${at}: must be a string of 1-${max} characters`)
    }
  }
  if (typeof value === 'string') return one(value, '')
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value)
    if (keys.length > 20) issues.push(`${field}: too many locales (max 20)`)
    for (const [locale, text] of Object.entries(value)) one(text, `.${locale}`)
    if (value.en === undefined && value.zh === undefined) {
      issues.push(`${field}: a localized field must provide at least one of "en" or "zh"`)
    }
    return
  }
  issues.push(`${field}: must be a string or a locale table`)
}

function expandPermissions(declared) {
  const out = new Set()
  for (const entry of declared) {
    if (entry.endsWith('.*')) {
      const ns = entry.slice(0, -2)
      for (const p of PERMISSIONS) if (p.startsWith(`${ns}.`)) out.add(p)
    } else out.add(entry)
  }
  return [...out]
}

function checkPermissionList(value, field, issues) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32) {
    issues.push(`${field}: must be an array of at most 32 entries`)
    return []
  }
  for (const entry of value) {
    const wildcardOk = typeof entry === 'string' && entry.endsWith('.*') && NAMESPACES.includes(entry.slice(0, -2))
    if (!PERMISSIONS.includes(entry) && !wildcardOk) {
      issues.push(
        `${field}: unknown permission "${entry}" (use a known method like "file.save" or a namespace wildcard like "file.*")`
      )
    }
  }
  return expandPermissions(value.filter((e) => typeof e === 'string'))
}

async function walk(dir, base = dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, base, out)
    else if (entry.isFile()) out.push({ full, rel: path.relative(base, full).split(path.sep).join('/') })
  }
  return out
}

export async function validateApp(appDir) {
  const issues = []
  const manifestPath = path.join(appDir, 'manifest.json')
  let raw
  try {
    raw = await fs.readFile(manifestPath)
  } catch {
    return { ok: false, issues: ['manifest.json: missing at the package root'] }
  }
  if (raw.length > MAX_MANIFEST_BYTES) issues.push(`manifest.json: over the ${MAX_MANIFEST_BYTES} byte limit`)
  let manifest
  try {
    manifest = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    return { ok: false, issues: [`manifest.json: invalid JSON (${error.message})`] }
  }

  if (typeof manifest.id !== 'string' || manifest.id.length > 120 || !ID_RE.test(manifest.id)) {
    issues.push('id: must be reverse-DNS, lowercase, max 120 characters')
  } else if (WINDOWS_RESERVED.has(manifest.id.split('.')[0])) {
    issues.push('id: starts with a Windows reserved device name')
  }
  checkLocalized(manifest.name, 64, 'name', issues)
  checkLocalized(manifest.description, 200, 'description', issues)
  if (manifest.releaseNotes !== undefined) checkLocalized(manifest.releaseNotes, 500, 'releaseNotes', issues)
  if (typeof manifest.version !== 'string' || manifest.version.length > 32 || !SEMVER_RE.test(manifest.version)) {
    issues.push('version: must be valid semver')
  }

  const entryProblem = checkRelativePath(manifest.entry)
  if (entryProblem) issues.push(`entry: ${entryProblem}`)
  else {
    const stat = await fs.stat(path.join(appDir, manifest.entry)).catch(() => null)
    if (!stat?.isFile()) issues.push(`entry: file is missing or not a regular file: ${manifest.entry}`)
  }

  if (manifest.icon !== undefined) {
    const iconProblem = checkRelativePath(manifest.icon?.path)
    if (iconProblem) issues.push(`icon.path: ${iconProblem}`)
    if (typeof manifest.icon?.sha256 !== 'string' || !SHA256_RE.test(manifest.icon.sha256)) {
      issues.push('icon.sha256: must be a lowercase hex SHA-256')
    }
    if (!iconProblem) {
      const bytes = await fs.readFile(path.join(appDir, manifest.icon.path)).catch(() => null)
      if (!bytes) issues.push(`icon.path: file is missing: ${manifest.icon.path}`)
      else {
        if (bytes.length > MAX_ICON_BYTES) issues.push(`icon: over the ${MAX_ICON_BYTES} byte limit`)
        const digest = createHash('sha256').update(bytes).digest('hex')
        if (SHA256_RE.test(manifest.icon.sha256 ?? '') && digest !== manifest.icon.sha256) {
          issues.push('icon.sha256: does not match the icon bytes')
        }
      }
    }
  }

  const required = checkPermissionList(manifest.permissions, 'permissions', issues)
  const optional = checkPermissionList(manifest.optionalPermissions, 'optionalPermissions', issues)
  const both = optional.filter((p) => required.includes(p))
  if (both.length > 0) issues.push(`optionalPermissions: also declared as required: ${both.join(', ')}`)

  if (manifest.network !== undefined) {
    if (!Array.isArray(manifest.network) || manifest.network.length > 20) {
      issues.push('network: must be an array of at most 20 hosts')
    } else {
      if (new Set(manifest.network).size !== manifest.network.length) issues.push('network: hosts must be unique')
      for (const host of manifest.network) {
        if (typeof host !== 'string' || !HOST_RE.test(host) || /(^|\.)(\d+|0x[0-9a-f]*)$/.test(host)) {
          issues.push(`network: "${host}" must be a bare hostname`)
        }
      }
    }
  }
  const networkHosts = Array.isArray(manifest.network) ? manifest.network : []
  const canReachNetwork = [...required, ...optional].some((p) => p.startsWith('network.'))
  if (networkHosts.length > 0 && !canReachNetwork)
    issues.push('network: declares hosts but no `network.*` permission to reach them')
  if (networkHosts.length === 0 && canReachNetwork)
    issues.push('permissions: declares a `network.*` permission but no hosts to use it on')

  if (manifest.update !== undefined) {
    for (const field of ['url', 'urlCn']) {
      const value = manifest.update?.[field]
      if (value === undefined) continue
      try {
        const url = new URL(value)
        if (url.protocol !== 'https:') issues.push(`update.${field}: must be an HTTPS URL`)
      } catch {
        issues.push(`update.${field}: must be a valid URL`)
      }
    }
    if (manifest.update?.url === undefined) issues.push('update: requires `url`')
  }

  const files = await walk(appDir)
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(file.rel).toLowerCase())) continue
    // Every text asset is scanned, whatever its size: skipping large ones lets a
    // bundle smuggle a development-server reference past AC2, and the read is
    // already bounded by the package size limits above.
    const bytes = await fs.readFile(file.full)
    const match = DEV_SERVER_RE.exec(bytes.toString('utf8'))
    if (match) issues.push(`${file.rel}: references a development server (${match[0]})`)
  }

  return { ok: issues.length === 0, issues }
}

// argv[1] is a raw filesystem path, import.meta.url a file URL: comparing them
// directly skips the CLI entirely on Windows or in a directory with spaces.
// Normalize the argv side to a URL so the documented `node <script>` invocation
// always enters (and importing the module never does).
const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isCliEntry) {
  const appDir = process.argv[2]
  if (!appDir) {
    console.error('Usage: node scripts/validate.mjs <appDir>')
    process.exit(2)
  }
  const result = await validateApp(path.resolve(appDir))
  if (result.ok) {
    console.log(JSON.stringify({ ok: true, appDir: path.resolve(appDir) }))
  } else {
    console.error(JSON.stringify({ ok: false, issues: result.issues }, null, 2))
    process.exit(1)
  }
}
