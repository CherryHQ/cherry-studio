const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { Arch } = require('electron-builder')

exports.default = async function (context) {
  const platform = context.packager.platform.name
  if (platform === 'windows') {
    fs.rmSync(path.join(context.appOutDir, 'LICENSE.electron.txt'), { force: true })
    fs.rmSync(path.join(context.appOutDir, 'LICENSES.chromium.html'), { force: true })
  }

  // Revert changes made by pnpm install in before-pack (only if architecture differs)
  const arch = context.arch
  const archType = arch === Arch.arm64 ? 'arm64' : 'x64'
  if (archType !== process.arch) {
    console.log('Reverting package.json and pnpm-lock.yaml changes...')
    execSync('git checkout package.json pnpm-lock.yaml', { stdio: 'inherit' })
  }
}
