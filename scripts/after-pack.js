const { Arch } = require('electron-builder')
const { default: removeLocales } = require('./remove-locales')
const fs = require('fs')
const path = require('path')

exports.default = async function (context) {
  await removeLocales(context)
  const platform = context.packager.platform.name
  const arch = context.arch

  if (platform === 'mac') {
    const node_modules_path = path.join(
      context.appOutDir,
      'Cherry Studio.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules'
    )

    removeDifferentArchNodeFiles(node_modules_path, '@libsql', arch === Arch.arm64 ? ['darwin-arm64'] : ['darwin-x64'])
  }

  if (platform === 'linux') {
    const node_modules_path = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
    const _arch = arch === Arch.arm64 ? ['linux-arm64-gnu', 'linux-arm64-musl'] : ['linux-x64-gnu', 'linux-x64-musl']
    removeDifferentArchNodeFiles(node_modules_path, '@libsql', _arch)
  }

  if (platform === 'windows') {
    const node_modules_path = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
    if (arch === Arch.arm64) {
      removeDifferentArchNodeFiles(node_modules_path, '@strongtz', ['win32-arm64-msvc'])
      removeDifferentArchNodeFiles(node_modules_path, '@libsql', ['win32-arm64-msvc'])
    }
    if (arch === Arch.x64) {
      removeDifferentArchNodeFiles(node_modules_path, '@strongtz', ['win32-x64-msvc'])
      removeDifferentArchNodeFiles(node_modules_path, '@libsql', ['win32-x64-msvc'])
    }
  }
}

function removeDifferentArchNodeFiles(nodeModulesPath, packageName, arch) {
  const modulePath = path.join(nodeModulesPath, packageName)
  const dirs = fs.readdirSync(modulePath)
  dirs
    .filter((dir) => !arch.includes(dir))
    .forEach((dir) => {
      fs.rmSync(path.join(modulePath, dir), { recursive: true, force: true })
      console.log(`Removed dir: ${dir}`, arch)
    })
}
