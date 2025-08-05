const { Arch } = require('electron-builder')
const fs = require('fs')
const path = require('path')

exports.default = async function (context) {
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

    keepPackageNodeFiles(node_modules_path, '@libsql', arch === Arch.arm64 ? ['darwin-arm64'] : ['darwin-x64'])
  }

  if (platform === 'linux') {
    const node_modules_path = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
    const _arch = arch === Arch.arm64 ? ['linux-arm64-gnu', 'linux-arm64-musl'] : ['linux-x64-gnu', 'linux-x64-musl']
    keepPackageNodeFiles(node_modules_path, '@libsql', _arch)

    // 删除 macOS 专用的 OCR 包
    removeMacOnlyPackages(node_modules_path)
  }

  if (platform === 'windows') {
    const node_modules_path = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
    if (arch === Arch.arm64) {
      keepPackageNodeFiles(node_modules_path, '@strongtz', ['win32-arm64-msvc'])
      keepPackageNodeFiles(node_modules_path, '@libsql', ['win32-arm64-msvc'])
    }
    if (arch === Arch.x64) {
      keepPackageNodeFiles(node_modules_path, '@strongtz', ['win32-x64-msvc'])
      keepPackageNodeFiles(node_modules_path, '@libsql', ['win32-x64-msvc'])
    }

    removeMacOnlyPackages(node_modules_path)
  }

  if (platform === 'windows') {
    fs.rmSync(path.join(context.appOutDir, 'LICENSE.electron.txt'), { force: true })
    fs.rmSync(path.join(context.appOutDir, 'LICENSES.chromium.html'), { force: true })
  }
}

/**
 * 删除 macOS 专用的包
 * @param {string} nodeModulesPath
 */
function removeMacOnlyPackages(nodeModulesPath) {
  const macOnlyPackages = []

  macOnlyPackages.forEach((packageName) => {
    const packagePath = path.join(nodeModulesPath, packageName)
    if (fs.existsSync(packagePath)) {
      fs.rmSync(packagePath, { recursive: true, force: true })
      console.log(`[After Pack] Removed macOS-only package: ${packageName}`)
    }
  })
}

/**
 * 使用指定架构的 node_modules 文件
 * @param {*} nodeModulesPath
 * @param {*} packageName
 * @param {*} arch
 * @returns
 */
function keepPackageNodeFiles(nodeModulesPath, packageName, arch) {
  const modulePath = path.join(nodeModulesPath, packageName)

  if (!fs.existsSync(modulePath)) {
    console.log(`[After Pack] Directory does not exist: ${modulePath}`)
    return
  }

  const dirs = fs.readdirSync(modulePath)
  dirs
    .filter((dir) => !arch.includes(dir))
    .forEach((dir) => {
      fs.rmSync(path.join(modulePath, dir), { recursive: true, force: true })
      console.log(`[After Pack] Removed dir: ${dir}`, arch)
    })
}
