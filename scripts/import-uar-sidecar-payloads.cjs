const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const manifestPath = path.join(root, 'build', 'integration-artifacts.json')
const sourcesPath = path.join(root, 'build', 'integration-sources.json')
const requiredPlatforms = new Set(['win32-x64', 'darwin-arm64'])
const cliRecordUrls = process.argv.slice(2)
const recordUrls =
  cliRecordUrls.length > 0
    ? cliRecordUrls
    : [process.env.UAR_WIN32_X64_RECORD_URL, process.env.UAR_DARWIN_ARM64_RECORD_URL]

if (recordUrls.length !== requiredPlatforms.size || recordUrls.some((recordUrl) => !recordUrl)) {
  throw new Error(
    'usage: node scripts/import-uar-sidecar-payloads.cjs <win32-x64-record-url> <darwin-arm64-record-url>, or set UAR_WIN32_X64_RECORD_URL and UAR_DARWIN_ARM64_RECORD_URL'
  )
}

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'))
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function validateReleaseUrl(value, repository, platform, version) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid UAR sidecar record URL: ${value}`)
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search || url.hash) {
    throw new Error(`UAR sidecar records must use immutable GitHub Release URLs: ${value}`)
  }

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const expectedRepository = repository.split('/')
  if (
    parts.length !== 6 ||
    parts[0].toLowerCase() !== expectedRepository[0].toLowerCase() ||
    parts[1].toLowerCase() !== expectedRepository[1].toLowerCase() ||
    parts[2] !== 'releases' ||
    parts[3] !== 'download' ||
    parts[5] !== `uar-sidecar-${platform}.json`
  ) {
    throw new Error(`Unexpected UAR sidecar record URL: ${value}`)
  }

  const tagPattern = new RegExp(
    `^boss-sidecar-${escapeRegExp(platform)}-v${escapeRegExp(version)}(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$`
  )
  if (!tagPattern.test(parts[4])) {
    throw new Error(`UAR sidecar release tag ${parts[4]} does not match ${platform} version ${version}`)
  }

  return { url, tag: parts[4] }
}

function validateBinaries(value, platform) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`UAR sidecar ${platform} record has no packaged binaries`)
  }

  const binaries = value.map((entry) => {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.trim() !== entry ||
      entry.startsWith('/') ||
      entry.includes('\\') ||
      entry.split('/').includes('..')
    ) {
      throw new Error(`Invalid packaged path in UAR sidecar ${platform} record`)
    }
    return entry
  })

  if (new Set(binaries).size !== binaries.length) {
    throw new Error(`UAR sidecar ${platform} record contains duplicate packaged paths`)
  }

  const executable = platform === 'win32-x64' ? 'uar-sidecar.exe' : 'uar-sidecar'
  for (const required of [executable, 'payload-manifest.json']) {
    if (!binaries.includes(required)) throw new Error(`UAR sidecar ${platform} record is missing ${required}`)
  }

  return binaries
}

async function loadRecord(recordUrl, pins, expectedVersion) {
  const response = await fetch(recordUrl, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Unable to download UAR sidecar record ${recordUrl}: HTTP ${response.status}`)

  const record = requireObject(JSON.parse(await response.text()), `UAR sidecar record ${recordUrl}`)
  if (!requiredPlatforms.has(record.platform)) {
    throw new Error(`Unsupported UAR sidecar platform: ${record.platform}`)
  }

  const { url, tag } = validateReleaseUrl(recordUrl, pins.repository, record.platform, expectedVersion)
  if (record.name !== 'uar-sidecar') throw new Error(`Unexpected UAR sidecar record name: ${record.name}`)
  if (record.version !== expectedVersion) {
    throw new Error(`UAR sidecar ${record.platform} version ${record.version} does not match ${expectedVersion}`)
  }
  if (record.source !== pins.revision) {
    throw new Error(`UAR sidecar ${record.platform} source ${record.source} does not match ${pins.revision}`)
  }

  const expectedAsset = `uar-sidecar-${record.platform}.tar.gz`
  if (record.asset !== expectedAsset) {
    throw new Error(`Unexpected UAR sidecar ${record.platform} asset: ${record.asset}`)
  }
  if (record.archive !== 'tar.gz') {
    throw new Error(`Unexpected UAR sidecar ${record.platform} archive: ${record.archive}`)
  }
  if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) {
    throw new Error(`Invalid UAR sidecar ${record.platform} SHA-256`)
  }

  return {
    platform: record.platform,
    package: {
      url: `https://${url.host}/${pins.repository}/releases/download/${tag}/${expectedAsset}`,
      sha256: record.sha256,
      archive: record.archive,
      binaries: validateBinaries(record.binaries, record.platform)
    }
  }
}

async function main() {
  const pins = requireObject(loadJson(sourcesPath), 'integration source pins')
  const manifest = requireObject(loadJson(manifestPath), 'integration artifact manifest')
  const uarSource = requireObject(pins.sources?.uar, 'integration UAR source pin')
  const expectedVersion = pins.tools?.['uar-sidecar']?.version

  if (!/^[a-f0-9]{40}$/.test(uarSource.revision ?? '')) throw new Error('Integration UAR source revision is not pinned')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(uarSource.repository ?? '')) {
    throw new Error('Integration UAR source repository is invalid')
  }
  if (typeof expectedVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(expectedVersion)) {
    throw new Error('Integration UAR sidecar version is invalid')
  }

  const tools = Array.isArray(manifest.tools) ? manifest.tools : []
  const matches = tools.filter((tool) => tool?.name === 'uar-sidecar')
  if (matches.length !== 1) throw new Error('Integration artifact manifest must contain one uar-sidecar tool')
  if (matches[0].version !== expectedVersion) {
    throw new Error(`Integration artifact UAR version ${matches[0].version} does not match ${expectedVersion}`)
  }

  const records = await Promise.all(recordUrls.map((recordUrl) => loadRecord(recordUrl, uarSource, expectedVersion)))
  const platforms = new Set(records.map((record) => record.platform))
  for (const platform of requiredPlatforms) {
    if (!platforms.has(platform)) throw new Error(`Missing UAR sidecar release record for ${platform}`)
  }

  const nextPackages = { ...matches[0].packages }
  for (const record of records) nextPackages[record.platform] = record.package

  const nextManifest = {
    ...manifest,
    sources: { ...manifest.sources, uar: { ...uarSource } },
    tools: tools.map((tool) =>
      tool === matches[0] ? { ...tool, version: expectedVersion, packages: nextPackages } : tool
    )
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`)

  console.log(`Imported UAR sidecar payloads for ${[...requiredPlatforms].join(', ')} from ${uarSource.revision}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
