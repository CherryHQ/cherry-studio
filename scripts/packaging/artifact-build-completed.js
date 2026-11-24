const fs = require('fs')
const path = require('path')

const { getReleaseProductName } = require('../release/edition')

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

// Minimum NT release advertised in Windows update manifests (`latest.yml`).
// Must match the runtime floor in `src/shared/utils/osSupport.ts`
// (Windows 10 1809 / build 17763). electron-updater compares this against the
// client's local `os.release()` and withholds the update when the client is
// older — this is what protects already-installed pre-gate clients (e.g. on
// build 17134) that send no `X-OS-Release` header and have no client-side gate.
const MIN_SUPPORTED_WINDOWS_NT_RELEASE = '10.0.17763'

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
  // Pin the Windows floor into the update manifest before it is advertised.
  // Runs per artifact, so both Windows arch manifests (x64/arm64) carry it.
  // `createUpdateInfo` merges `event.updateInfo` into `latest.yml`, and
  // electron-updater@6.7.0 withholds the update when `os.release()` is older
  // than this floor — verified: offered without it, withheld with it.
  try {
    if (buildResult.packager?.platform?.name === 'windows') {
      buildResult.updateInfo = {
        ...buildResult.updateInfo,
        minimumSystemVersion: MIN_SUPPORTED_WINDOWS_NT_RELEASE
      }
    }
  } catch (error) {
    console.warn(`[artifact build completed] failed to set minimumSystemVersion: ${error?.message || error}`)
  }

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
exports.MIN_SUPPORTED_WINDOWS_NT_RELEASE = MIN_SUPPORTED_WINDOWS_NT_RELEASE
exports.normalizeArtifactFilePath = normalizeArtifactFilePath
exports.default = artifactBuildCompleted
