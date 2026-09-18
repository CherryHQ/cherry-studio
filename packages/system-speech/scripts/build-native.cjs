const { spawnSync } = require('node:child_process')
const { chmodSync, copyFileSync, mkdirSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

function buildNativeHelper(arch) {
  if (process.platform !== 'darwin') throw new Error('Apple speech helper requires a macOS build host')
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

exports.buildNativeHelper = buildNativeHelper

if (require.main === module) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  if (args.length && (args.length !== 2 || args[0] !== '--arch')) throw new Error('Expected --arch arm64 or --arch x64')
  buildNativeHelper(args[1] ?? process.arch)
}
