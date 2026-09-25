const { Arch } = require('electron-builder')
const fs = require('fs')
const path = require('path')

const { readProjectBuildMetadata, replacePackagedBetterSqlite3 } = require('./linux-native/compat')
const { resolveReleaseProfile } = require('./release-profile.cjs')
const { assertPackagedUarPayloadAbsent, verifyAndProbePackagedUarPayload } = require('./uar-payload-integrity.cjs')

function verifyPackagedUarSidecar(context, platform) {
  const arch = context.arch === Arch.arm64 ? 'arm64' : context.arch === Arch.x64 ? 'x64' : null
  const platformPrefix = platform === 'mac' ? 'darwin' : platform === 'windows' ? 'win32' : null
  if (!arch || !platformPrefix) return

  const platformKey = `${platformPrefix}-${arch}`

  const resourcesDir =
    platform === 'mac'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')
  if (resolveReleaseProfile().uarEnabled) {
    verifyAndProbePackagedUarPayload(resourcesDir, platformKey)
  } else {
    assertPackagedUarPayloadAbsent(resourcesDir, platformKey)
  }
}

exports.default = async function (context) {
  const platform = context.packager.platform.name
  verifyPackagedUarSidecar(context, platform)
  if (platform === 'windows') {
    fs.rmSync(path.join(context.appOutDir, 'LICENSE.electron.txt'), { force: true })
    fs.rmSync(path.join(context.appOutDir, 'LICENSES.chromium.html'), { force: true })
  } else if (platform === 'linux') {
    const arch = context.arch === Arch.arm64 ? 'arm64' : context.arch === Arch.x64 ? 'x64' : null
    if (!arch) throw new Error(`Unsupported Linux packaging architecture: ${context.arch}`)

    const projectRoot = path.join(__dirname, '..')
    const { destination, manifest } = replacePackagedBetterSqlite3({
      projectRoot,
      appOutDir: context.appOutDir,
      arch,
      metadata: readProjectBuildMetadata(projectRoot)
    })
    process.stdout.write(
      `Installed GLIBC-compatible better-sqlite3 for linux-${arch} at ${destination} ` +
        `(ABI ${manifest.electronAbi}, ${JSON.stringify(manifest.requirements)})\n`
    )
  }
}
