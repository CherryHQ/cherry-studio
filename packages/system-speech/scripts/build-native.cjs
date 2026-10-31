const { spawnSync } = require('node:child_process')
const { chmodSync, copyFileSync, mkdirSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

function buildAppleHelper(arch) {
  const triple = { arm64: 'arm64-apple-macosx13.0', x64: 'x86_64-apple-macosx13.0' }[arch]
  if (!triple) throw new Error('Unsupported Apple speech helper architecture')
  const packageRoot = resolve(__dirname, '..')
  const args = ['swift', 'build', '--package-path', join(packageRoot, 'native'), '-c', 'release', '--triple', triple]
  const build = spawnSync('xcrun', args, { stdio: 'inherit' })
  if (build.status !== 0) throw new Error('Apple speech helper compilation failed')
  const binPath = spawnSync('xcrun', [...args, '--show-bin-path'], { encoding: 'utf8' })
  if (binPath.status !== 0) throw new Error('Apple speech helper output resolution failed')
  const destination = join(packageRoot, 'dist', 'native', `darwin-${arch}`, 'cherry-system-speech')
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(join(binPath.stdout.trim(), 'cherry-system-speech'), destination)
  chmodSync(destination, 0o755)
  return destination
}

function buildWindowsHelper(arch) {
  if (arch !== 'x64') throw new Error('Windows speech helper supports x64 only')
  const packageRoot = resolve(__dirname, '..')
  const destination = join(packageRoot, 'dist', 'native', 'win32-x64', 'cherry-system-speech.exe')
  const script = join(packageRoot, 'windows', 'build.cmd')
  const build = spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `""${script}" "${dirname(destination)}""`],
    {
      stdio: 'inherit',
      windowsHide: true,
      windowsVerbatimArguments: true
    }
  )
  if (build.error || build.status !== 0) throw new Error('Windows speech helper compilation failed')
  return destination
}

function buildNativeHelper(arch, platform = process.platform) {
  if (platform !== process.platform) throw new Error('System speech helper requires a matching build host')
  if (platform === 'darwin') return buildAppleHelper(arch)
  if (platform === 'win32') return buildWindowsHelper(arch)
  throw new Error('System speech helper requires a macOS or Windows build host')
}

exports.buildNativeHelper = buildNativeHelper

if (require.main === module) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  if (args.length && (args.length !== 2 || args[0] !== '--arch')) throw new Error('Expected --arch arm64 or --arch x64')
  buildNativeHelper(args[1] ?? process.arch)
}
