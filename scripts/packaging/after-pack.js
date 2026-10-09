const { Arch } = require('electron-builder')
const fs = require('fs')
const { createRequire } = require('node:module')
const path = require('path')

const { readProjectBuildMetadata, replacePackagedBetterSqlite3 } = require('../linux-native/compat')

function installComputerUseRuntime(context) {
  const platform = context.electronPlatformName
  const arch = context.arch === Arch.arm64 ? 'arm64' : context.arch === Arch.x64 ? 'x64' : null
  if (!['darwin', 'win32', 'linux'].includes(platform) || !arch) {
    throw new Error(`Unsupported Computer Use packaging target: ${platform}-${context.arch}`)
  }
  const projectRequire = createRequire(path.join(context.packager.projectDir, 'package.json'))
  const sdkEntry = projectRequire.resolve('@cherrystudio/computer-use')
  const sdkRoot = path.dirname(path.dirname(sdkEntry))
  const sdkVersion = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8')).version
  const packageName = `@cherrystudio/computer-use-${platform}-${arch}`
  const manifestPath = createRequire(sdkEntry).resolve(`${packageName}/package.json`)
  const nativeRoot = path.dirname(manifestPath)
  if (JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version !== sdkVersion) {
    throw new Error(`${packageName} must match SDK version ${sdkVersion}`)
  }

  const name =
    platform === 'darwin'
      ? 'Cherry Computer Use.app'
      : platform === 'win32'
        ? 'open-computer-use.exe'
        : 'open-computer-use'
  const source = path.join(nativeRoot, 'runtime', name)
  const executable = platform === 'darwin' ? path.join(source, 'Contents/MacOS/OpenComputerUse') : source
  fs.accessSync(executable, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
  if (!fs.statSync(executable).isFile()) throw new Error(`Computer Use runtime is not a file: ${executable}`)

  const destination = path.join(context.packager.getResourcesDir(context.appOutDir), 'computer-use')
  fs.mkdirSync(destination, { recursive: true })
  // Keep the host pathRegistry contract; the bundle's signed identity remains unchanged.
  fs.cpSync(source, path.join(destination, platform === 'darwin' ? 'Open Computer Use.app' : name), {
    recursive: true,
    verbatimSymlinks: true
  })
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    fs.copyFileSync(path.join(nativeRoot, file), path.join(destination, file))
  }
}
exports.installComputerUseRuntime = installComputerUseRuntime

exports.default = async function (context) {
  installComputerUseRuntime(context)
  const platform = context.packager.platform.name
  if (platform === 'windows') {
    fs.rmSync(path.join(context.appOutDir, 'LICENSE.electron.txt'), { force: true })
    fs.rmSync(path.join(context.appOutDir, 'LICENSES.chromium.html'), { force: true })
  } else if (platform === 'linux') {
    const arch = context.arch === Arch.arm64 ? 'arm64' : context.arch === Arch.x64 ? 'x64' : null
    if (!arch) throw new Error(`Unsupported Linux packaging architecture: ${context.arch}`)

    const projectRoot = path.join(__dirname, '../..')
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
