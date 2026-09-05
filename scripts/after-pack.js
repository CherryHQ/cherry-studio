const { Arch } = require('electron-builder')
const fs = require('fs')
const path = require('path')

const { readProjectBuildMetadata, replacePackagedBetterSqlite3 } = require('./linux-native/compat')
const { discoverDshRuntimePackaging, isNativeFilePath } = require('../packages/dsh-bridge/scripts/runtimeEntries.cjs')

const nodeModuleLocations = (relativePath) => {
  const parts = relativePath.replaceAll('\\', '/').split('/')
  const locations = []
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== 'node_modules') continue
    const packageName = parts[index + 1]?.startsWith('@') ? `${parts[index + 1]}/${parts[index + 2]}` : parts[index + 1]
    const packageParts = packageName?.startsWith('@') ? 2 : 1
    if (!packageName || parts[index + 1] === undefined || parts[index + packageParts + 1] === undefined) continue
    locations.push({ packageName, relative: parts.slice(index + packageParts + 1).join('/') })
  }
  return locations
}

function assertDshAsarBoundary(context) {
  const platformName = context.packager.platform.name
  const platform =
    platformName === 'mac'
      ? 'darwin'
      : platformName === 'windows'
        ? 'win32'
        : platformName === 'linuxmusl'
          ? 'linux'
          : platformName
  const arch = context.arch === Arch.arm64 ? 'arm64' : 'x64'
  const projectRoot = path.join(__dirname, '..')
  const runtime = discoverDshRuntimePackaging({
    packageRoot: path.join(projectRoot, 'packages/dsh-bridge'),
    platform,
    arch
  })
  const resourcesRoot = context.packager.getResourcesDir(context.appOutDir)
  const unpackedRoot = path.join(resourcesRoot, 'app.asar.unpacked')
  const runtimeRoot = path.join(unpackedRoot, 'node_modules', '@cherrystudio', 'dsh-bridge', 'dist', 'runtime')
  const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing unpacked DSH runtime manifest: ${manifestPath}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const [specifier, fileName] of Object.entries(manifest.entries ?? {})) {
    if (typeof fileName !== 'string' || !fs.existsSync(path.join(runtimeRoot, fileName))) {
      throw new Error(`Missing unpacked DSH runtime entry ${specifier}: ${fileName}`)
    }
  }

  const external = new Set(runtime.externalPackageNames)
  const foreign = new Set(runtime.foreignNativePaths.map(({ packageName, relative }) => `${packageName}/${relative}`))
  const violations = []
  const nodeModulesRoot = path.join(unpackedRoot, 'node_modules')
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return
    if (directory === runtimeRoot) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) {
        const relativePath = path.relative(unpackedRoot, absolute).replaceAll(path.sep, '/')
        for (const location of nodeModuleLocations(relativePath)) {
          if (runtime.dshPackageNames.includes(location.packageName) && !external.has(location.packageName)) {
            violations.push(`unbundled DSH package ${relativePath}`)
          }
          if (isNativeFilePath(location.relative) && foreign.has(`${location.packageName}/${location.relative}`)) {
            violations.push(`foreign native file ${relativePath}`)
          }
        }
      }
    }
  }
  walk(nodeModulesRoot)
  if (violations.length > 0) {
    throw new Error(`Invalid DSH asar boundary for ${platform}-${arch}:\n${violations.slice(0, 20).join('\n')}`)
  }
}

exports.assertDshAsarBoundary = assertDshAsarBoundary

exports.default = async function (context) {
  assertDshAsarBoundary(context)
  const platform = context.packager.platform.name
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
