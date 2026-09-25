const { Arch } = require('electron-builder')
const fs = require('fs')
const path = require('path')

const { readProjectBuildMetadata, replacePackagedBetterSqlite3 } = require('./linux-native/compat')

function verifyPackagedUarSidecar(context, platform) {
  const arch = context.arch === Arch.arm64 ? 'arm64' : context.arch === Arch.x64 ? 'x64' : null
  const platformPrefix = platform === 'mac' ? 'darwin' : platform === 'windows' ? 'win32' : null
  if (!arch || !platformPrefix) return

  const platformKey = `${platformPrefix}-${arch}`
  if (!['darwin-arm64', 'win32-x64'].includes(platformKey)) return

  const manifest = require('../build/integration-artifacts.json')
  const sidecar = manifest.tools.find((tool) => tool.name === 'uar-sidecar')
  const payload = sidecar?.packages[platformKey]
  if (!payload) throw new Error(`Integration artifact manifest is missing uar-sidecar ${platformKey}`)

  const resourcesDir =
    platform === 'mac'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')
  const payloadDir = path.join(resourcesDir, 'app.asar.unpacked', 'resources', 'binaries', platformKey)
  const missing = payload.binaries.filter((filename) => !fs.existsSync(path.join(payloadDir, filename)))
  if (missing.length > 0) {
    throw new Error(`Packaged UAR sidecar payload is incomplete for ${platformKey}: ${missing.join(', ')}`)
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
