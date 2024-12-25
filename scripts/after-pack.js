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

    removeDifferentArchNodeFiles(
      node_modules_path,
      '@lancedb',
      arch === Arch.arm64 ? ['lancedb-darwin-arm64'] : ['lancedb-darwin-x64']
    )
  }

  if (platform === 'linux') {
    const node_modules_path = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
    const _arch =
      arch === Arch.arm64
        ? ['lancedb-linux-arm64-gnu', 'lancedb-linux-arm64-musl']
        : ['lancedb-linux-x64-gnu', 'lancedb-linux-x64-musl']
    removeDifferentArchNodeFiles(node_modules_path, '@lancedb', _arch)
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
