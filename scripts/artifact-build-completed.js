const fs = require('fs')
const path = require('path')

const { getReleaseProductName } = require('./release/edition')

const PLATFORM_PREFIXES = {
  linux: 'linux',
  mac: 'mac',
  windows: 'win'
}

const ARCH_ALIASES = {
  aarch64: 'arm64',
  amd64: 'x64',
  arm64: 'arm64',
  x64: 'x64',
  x86_64: 'x64'
}

function normalizeArtifactFilePath(file, productName, version, platform, releaseProductName = productName) {
  const normalizedFileName = path.basename(file).replace(/ /g, '-')
  const normalizedProductName = productName.replace(/ /g, '-')
  const normalizedReleaseProductName = releaseProductName.replace(/ /g, '-')
  const productVersionPrefix = `${normalizedProductName}-${version}-`
  const platformPrefix = PLATFORM_PREFIXES[platform]

  // Update manifests and unrelated files must keep their stable names. Only
  // electron-builder artifacts carrying this app's product + version prefix
  // participate in the public release-asset naming contract.
  if (!platformPrefix || !normalizedFileName.startsWith(productVersionPrefix)) {
    return path.join(path.dirname(file), normalizedFileName)
  }

  let artifactSuffix = normalizedFileName.slice(productVersionPrefix.length)
  artifactSuffix = artifactSuffix.replace(/^(?:win|windows|mac|linux)-/, '')

  const archMatch = /^(aarch64|amd64|arm64|x64|x86_64)(?=[.-])/.exec(artifactSuffix)
  if (archMatch) {
    artifactSuffix = `${ARCH_ALIASES[archMatch[1]]}${artifactSuffix.slice(archMatch[1].length)}`
  }

  return path.join(path.dirname(file), `${normalizedReleaseProductName}-${version}-${platformPrefix}-${artifactSuffix}`)
}

function artifactBuildCompleted(buildResult) {
  const oldFilePath = buildResult.file
  const edition = buildResult.packager.config.extraMetadata?.cherryEdition ?? 'global'
  const newFilePath = normalizeArtifactFilePath(
    oldFilePath,
    buildResult.packager.appInfo.productName,
    buildResult.packager.appInfo.version,
    buildResult.packager.platform.name,
    getReleaseProductName(buildResult.packager.appInfo.productName, edition)
  )

  if (oldFilePath === newFilePath) return

  fs.renameSync(oldFilePath, newFilePath)
  buildResult.file = newFilePath
  if (buildResult.safeArtifactName != null) {
    buildResult.safeArtifactName = path.basename(newFilePath)
  }
  console.log(`[artifact build completed] renamed ${oldFilePath} to ${newFilePath}`)
}

exports.ARCH_ALIASES = ARCH_ALIASES
exports.PLATFORM_PREFIXES = PLATFORM_PREFIXES
exports.normalizeArtifactFilePath = normalizeArtifactFilePath
exports.default = artifactBuildCompleted
