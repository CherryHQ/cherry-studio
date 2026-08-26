const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { getNativeArtifactPaths, readProjectBuildMetadata, verifyNativeArtifact } = require('./compat')

const RELEASE_SCHEMA_VERSION = 1
const SUPPORTED_ARCHS = Object.freeze(['x64', 'arm64'])

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function readReleaseConfig(configPath = path.join(__dirname, 'release.json')) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (config.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported better-sqlite3 release schema: expected ${RELEASE_SCHEMA_VERSION}, found ${config.schemaVersion}`
    )
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) {
    throw new Error(`Invalid better-sqlite3 release repository: ${config.repository}`)
  }
  if (!config.tag || !config.metadata || !config.artifacts) {
    throw new Error('Incomplete better-sqlite3 release configuration')
  }
  return config
}

function assertReleaseMetadata(releaseMetadata, projectMetadata) {
  for (const field of ['electronVersion', 'electronAbi', 'betterSqlite3Version']) {
    if (releaseMetadata[field] !== projectMetadata[field]) {
      throw new Error(
        `Pinned better-sqlite3 release field ${field} is stale: ` +
          `expected ${projectMetadata[field]}, found ${releaseMetadata[field]}`
      )
    }
  }
}

function validateAsset(asset, arch, kind) {
  if (!asset || !/^[A-Za-z0-9_.-]+$/.test(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(`Invalid ${arch} better-sqlite3 ${kind} release asset`)
  }
}

function releaseAssetUrl(config, assetName) {
  return `https://github.com/${config.repository}/releases/download/${encodeURIComponent(config.tag)}/${encodeURIComponent(assetName)}`
}

function verifyPinnedFile(filePath, asset) {
  const actual = sha256(fs.readFileSync(filePath))
  if (actual !== asset.sha256) {
    throw new Error(`Downloaded ${asset.name} checksum mismatch: expected ${asset.sha256}, found ${actual}`)
  }
}

function verifyReleaseArtifact({ artifactPaths, assets, expected }) {
  verifyPinnedFile(artifactPaths.addonPath, assets.addon)
  verifyPinnedFile(artifactPaths.manifestPath, assets.manifest)
  return verifyNativeArtifact({ ...artifactPaths, expected })
}

function downloadWithCurl(url, destination) {
  execFileSync(
    'curl',
    ['-fSL', '--retry', '3', '--connect-timeout', '15', '--max-time', '120', '-o', destination, url],
    { stdio: 'inherit' }
  )
}

function ensureLinuxNativeArtifact({
  projectRoot,
  arch,
  config = readReleaseConfig(),
  metadata = readProjectBuildMetadata(projectRoot),
  downloadImpl = downloadWithCurl
}) {
  if (!SUPPORTED_ARCHS.includes(arch)) {
    throw new Error(`Unsupported Linux architecture: ${arch}`)
  }
  assertReleaseMetadata(config.metadata, metadata)
  const assets = config.artifacts[arch]
  validateAsset(assets?.addon, arch, 'addon')
  validateAsset(assets?.manifest, arch, 'manifest')

  const artifactPaths = getNativeArtifactPaths(projectRoot, arch)
  const expected = { ...metadata, arch }
  try {
    const verified = verifyReleaseArtifact({ artifactPaths, assets, expected })
    return { ...verified, cached: true, ...artifactPaths }
  } catch {
    // A missing or stale cache entry is replaced atomically below.
  }

  const temporaryDir = `${artifactPaths.outputDir}.tmp-${process.pid}-${Date.now()}`
  const temporaryPaths = {
    addonPath: path.join(temporaryDir, 'better_sqlite3.node'),
    manifestPath: path.join(temporaryDir, 'manifest.json')
  }
  fs.rmSync(temporaryDir, { recursive: true, force: true })
  fs.mkdirSync(temporaryDir, { recursive: true })

  try {
    downloadImpl(releaseAssetUrl(config, assets.addon.name), temporaryPaths.addonPath)
    downloadImpl(releaseAssetUrl(config, assets.manifest.name), temporaryPaths.manifestPath)
    const verified = verifyReleaseArtifact({ artifactPaths: temporaryPaths, assets, expected })
    fs.rmSync(artifactPaths.outputDir, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(artifactPaths.outputDir), { recursive: true })
    fs.renameSync(temporaryDir, artifactPaths.outputDir)
    return { ...verified, cached: false, ...artifactPaths }
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true })
  }
}

module.exports = {
  ensureLinuxNativeArtifact,
  readReleaseConfig
}
