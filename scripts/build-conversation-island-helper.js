const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const PACKAGE_PATH = 'packages/conversation-island-helper'
const EXECUTABLE_NAME = 'conversation-island-helper'

function resolveSwiftArchitecture(arch) {
  if (arch === 'arm64') return 'arm64'
  if (arch === 'x64') return 'x86_64'
  throw new Error(`Unsupported conversation island helper architecture: ${arch}`)
}

function buildConversationIslandHelper({
  platform = process.platform,
  arch = process.arch,
  execFileSync = childProcess.execFileSync,
  fs: fsAdapter = fs,
  projectRoot = path.join(__dirname, '..')
} = {}) {
  if (platform !== 'darwin') return undefined

  const swiftArch = resolveSwiftArchitecture(arch)
  const buildArgs = ['build', '--package-path', PACKAGE_PATH, '-c', 'release', '--arch', swiftArch]
  execFileSync('swift', buildArgs, { cwd: projectRoot, stdio: 'inherit' })

  const binPath = String(
    execFileSync('swift', [...buildArgs, '--show-bin-path'], { cwd: projectRoot, encoding: 'utf8' })
  ).trim()
  const sourcePath = path.join(binPath, EXECUTABLE_NAME)
  const architectures = String(execFileSync('lipo', ['-archs', sourcePath], { encoding: 'utf8' }))
    .trim()
    .split(/\s+/)

  if (!architectures.includes(swiftArch)) {
    throw new Error(`${EXECUTABLE_NAME} is missing Mach-O architecture ${swiftArch}`)
  }

  const destinationPath = path.join(projectRoot, 'resources', 'binaries', `darwin-${arch}`, EXECUTABLE_NAME)
  fsAdapter.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fsAdapter.copyFileSync(sourcePath, destinationPath)
  fsAdapter.chmodSync(destinationPath, 0o755)
  return destinationPath
}

function readCliArch(argv) {
  const archFlagIndex = argv.indexOf('--arch')
  if (archFlagIndex === -1) return process.arch
  if (!argv[archFlagIndex + 1]) throw new Error('Missing value for --arch')
  return argv[archFlagIndex + 1]
}

if (require.main === module) {
  buildConversationIslandHelper({ arch: readCliArch(process.argv.slice(2)) })
}

module.exports = { buildConversationIslandHelper, resolveSwiftArchitecture }
