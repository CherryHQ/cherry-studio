const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const sourceFiles = [
  __filename,
  ...['terminalScope.c', 'terminalScopeWindows.c', 'build.cmd'].map((file) => path.join(__dirname, file))
]

function buildTerminalScope({ platform = process.platform, arch = process.arch, packaging = false } = {}) {
  if (
    platform !== process.platform ||
    !['darwin', 'linux', 'win32'].includes(platform) ||
    !['x64', 'arm64'].includes(arch)
  )
    throw new Error(`Unsupported terminal scope build: ${platform}-${arch}`)
  const directory = path.join(root, 'resources', 'binaries', `${platform}-${arch}`)
  const name = platform === 'win32' ? 'terminal-scope.exe' : 'terminal-scope'
  const destination = path.join(directory, name)
  if (
    !packaging &&
    existsSync(destination) &&
    sourceFiles.every((file) => statSync(file).mtimeMs < statSync(destination).mtimeMs)
  )
    return destination
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(path.join(directory, '.terminal-scope-'))
  const output = path.join(temporary, name)
  try {
    if (platform === 'win32') {
      const script = path.join(__dirname, 'build.cmd')
      execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${script}" "${arch}" "${temporary}""`], {
        stdio: 'inherit',
        windowsHide: true,
        windowsVerbatimArguments: true
      })
    } else if (platform === 'darwin') {
      execFileSync(
        'cc',
        [
          '-std=c11',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-O2',
          '-arch',
          arch === 'x64' ? 'x86_64' : 'arm64',
          '-mmacosx-version-min=13.0',
          path.join(__dirname, 'terminalScope.c'),
          '-o',
          output
        ],
        { stdio: 'inherit' }
      )
    } else if (arch === process.arch && !packaging) {
      execFileSync(
        'cc',
        [
          '-std=c11',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-O2',
          '-static',
          path.join(__dirname, 'terminalScope.c'),
          '-o',
          output
        ],
        { stdio: 'inherit' }
      )
    } else {
      execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '--platform',
          `linux/${arch === 'x64' ? 'amd64' : 'arm64'}`,
          '--mount',
          `type=bind,source=${__dirname},target=/src,readonly`,
          '--mount',
          `type=bind,source=${temporary},target=/out`,
          'alpine:3.22.1',
          'sh',
          '-c',
          'apk add --no-cache build-base >/dev/null && cc -std=c11 -Wall -Wextra -Werror -O2 -static /src/terminalScope.c -o /out/terminal-scope'
        ],
        { stdio: 'inherit' }
      )
    }
    renameSync(output, destination)
    return destination
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

module.exports = { buildTerminalScope, sourceFiles }
if (require.main === module) buildTerminalScope({ arch: process.argv[2] ?? process.arch })
