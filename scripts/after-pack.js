const { Arch } = require('electron-builder')
const fs = require('fs')
const path = require('path')

const { readProjectBuildMetadata, replacePackagedBetterSqlite3 } = require('./linux-native/compat')

function verifyPackagedSelectionHook(appOutDir, arch) {
  const moduleDir = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'selection-hook')
  for (const variant of ['Release', 'Debug']) {
    const buildDir = path.join(moduleDir, 'build', variant)
    if (fs.existsSync(buildDir) && fs.readdirSync(buildDir).some((file) => file.endsWith('.node'))) {
      throw new Error(`Packaged selection-hook ${variant} build shadows the linux-${arch} prebuild`)
    }
  }

  const prebuild = path.join(moduleDir, 'prebuilds', `linux-${arch}`, 'selection-hook.node')
  if (!fs.existsSync(prebuild)) throw new Error(`Missing packaged linux-${arch} selection-hook prebuild`)

  const header = fs.readFileSync(prebuild).subarray(0, 20)
  if (header.length < 20 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error(`Packaged linux-${arch} selection-hook prebuild is not ELF`)
  }
  const machine = header.readUInt16LE(18)
  const actualArch = machine === 183 ? 'arm64' : machine === 62 ? 'x64' : `ELF machine ${machine}`
  if (actualArch !== arch) throw new Error(`Packaged selection-hook expected ${arch}, found ${actualArch}`)
  return prebuild
}
exports.verifyPackagedSelectionHook = verifyPackagedSelectionHook

exports.default = async function (context) {
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
    process.stdout.write(
      `Verified linux-${arch} selection-hook prebuild at ${verifyPackagedSelectionHook(context.appOutDir, arch)}\n`
    )
  }
}
