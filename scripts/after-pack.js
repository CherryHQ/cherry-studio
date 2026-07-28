const { Arch } = require('electron-builder')
const fs = require('fs')
const path = require('path')

function packageSqliteVecExtension({ projectDir, appOutDir, arch }) {
  const packageName = `sqlite-vec-windows-${arch}`
  const source = path.join(projectDir, 'node_modules', '@aiany', packageName, 'vec0.dll')
  const target = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    '@aiany',
    packageName,
    'vec0.dll'
  )

  if (!fs.existsSync(source) || !fs.statSync(source).isFile() || fs.statSync(source).size === 0) {
    throw new Error(`Missing sqlite-vec build dependency: ${source}`)
  }

  // electron-builder can mark this optional package as unpacked in app.asar without
  // carrying the DLL into Windows portable artifacts. Copy it explicitly to the path
  // returned by sqlite-vec's getLoadablePath() so both setup and portable builds work.
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)

  const sourceSize = fs.statSync(source).size
  const targetSize = fs.statSync(target).size
  if (targetSize !== sourceSize) {
    throw new Error(`Failed to package sqlite-vec extension: ${target}`)
  }

  return target
}

exports.packageSqliteVecExtension = packageSqliteVecExtension

exports.default = async function (context) {
  const platform = context.packager.platform.name
  if (platform === 'windows') {
    fs.rmSync(path.join(context.appOutDir, 'LICENSE.electron.txt'), { force: true })
    fs.rmSync(path.join(context.appOutDir, 'LICENSES.chromium.html'), { force: true })
    packageSqliteVecExtension({
      projectDir: context.packager.projectDir,
      appOutDir: context.appOutDir,
      arch: context.arch === Arch.arm64 ? 'arm64' : 'x64'
    })
  }
}
