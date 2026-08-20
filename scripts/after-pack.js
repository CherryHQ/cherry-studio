const { Arch } = require('electron-builder')
const fs = require('fs')
const path = require('path')

const { isForeignNativePath } = require('../packages/dsh-bridge/scripts/runtimeBuilder.cjs')
const { readProjectBuildMetadata, replacePackagedBetterSqlite3 } = require('./linux-native/compat')

const NATIVE_EXTENSIONS = new Set(['.dll', '.dylib', '.exe', '.node', '.so', '.wasm'])

function findForeignNativeFiles(nodeModules, platform, arch) {
  if (!fs.existsSync(nodeModules) || !platform || !arch) return []
  const foreign = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(candidate)
        continue
      }
      if (!NATIVE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      const normalized = path.relative(nodeModules, candidate).replaceAll(path.sep, '/')
      if (isForeignNativePath(normalized, platform, arch)) foreign.push(candidate)
    }
  }
  visit(nodeModules)
  return foreign
}

function listAsarPackage(archivePath) {
  try {
    const electronBuilderPath = require.resolve('electron-builder')
    const asarPath = require.resolve('@electron/asar', { paths: [path.dirname(electronBuilderPath)] })
    return require(asarPath).listPackage(archivePath)
  } catch (error) {
    throw new Error(`Unable to inspect packaged app.asar: ${archivePath}`, { cause: error })
  }
}

function assertDshRuntimeArchive(appOutDir, platform, arch) {
  if (!platform || !arch) return
  const resourceRoots = [path.join(appOutDir, 'resources'), path.join(appOutDir, 'Contents', 'Resources')]
  const archives = resourceRoots
    .map((resourceRoot) => path.join(resourceRoot, 'app.asar'))
    .filter((archivePath) => fs.existsSync(archivePath))
  if (archives.length === 0) return

  const variants = new Set()
  for (const archivePath of archives) {
    for (const entry of listAsarPackage(archivePath)) {
      const match = entry
        .replace(/^\/+/, '')
        .match(/^node_modules\/@cherrystudio\/dsh-bridge\/dist\/runtime\/([^/]+)\/dsh-runtime\.tar\.zst$/)
      if (match) variants.add(match[1])
    }
  }
  const expected = `${platform}-${arch}`
  if (variants.size !== 1 || !variants.has(expected)) {
    throw new Error(`Packaged DSH runtime archive mismatch: expected ${expected}, found ${[...variants].join(', ')}`)
  }
}

function assertDshAsarBoundary(appOutDir, platform, arch) {
  const resourceRoots = [path.join(appOutDir, 'resources'), path.join(appOutDir, 'Contents', 'Resources')]
  const unpackedRoots = resourceRoots.map((resourceRoot) =>
    path.join(resourceRoot, 'app.asar.unpacked', 'node_modules')
  )
  const foreign = unpackedRoots.flatMap((nodeModules) => findForeignNativeFiles(nodeModules, platform, arch))
  if (foreign.length > 0) {
    throw new Error(`Foreign native files remain unpacked for ${platform}-${arch}: ${foreign.join(', ')}`)
  }
  assertDshRuntimeArchive(appOutDir, platform, arch)
}
exports.assertDshAsarBoundary = assertDshAsarBoundary
exports.findForeignNativeFiles = findForeignNativeFiles
exports.assertDshRuntimeArchive = assertDshRuntimeArchive

exports.default = async function (context) {
  const platformName = context.packager.platform.name
  const platform = platformName === 'windows' ? 'win32' : platformName === 'mac' ? 'darwin' : platformName
  const arch = context.arch === Arch.arm64 ? 'arm64' : context.arch === Arch.x64 ? 'x64' : null
  assertDshAsarBoundary(context.appOutDir, platform, arch)
  if (platformName === 'windows') {
    fs.rmSync(path.join(context.appOutDir, 'LICENSE.electron.txt'), { force: true })
    fs.rmSync(path.join(context.appOutDir, 'LICENSES.chromium.html'), { force: true })
  } else if (platformName === 'linux') {
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
