const { execFileSync } = require('node:child_process')
const { mkdirSync, renameSync, rmSync } = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '../..')
const sourcePath = path.join(__dirname, 'selectionPanel.mm')

function buildSelectionPanel({ platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'darwin') return
  if (process.platform !== 'darwin') throw new Error('The selection panel addon must be built on macOS')
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported selection panel architecture: ${arch}`)

  const destination = path.join(projectRoot, 'resources/binaries', `darwin-${arch}`, 'selection-panel.node')
  mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  try {
    execFileSync(
      'xcrun',
      [
        'clang++',
        '-arch',
        arch === 'x64' ? 'x86_64' : 'arm64',
        '-std=c++17',
        '-fobjc-arc',
        '-bundle',
        '-undefined',
        'dynamic_lookup',
        '-framework',
        'AppKit',
        '-mmacosx-version-min=12.0',
        '-DNAPI_VERSION=8',
        '-I',
        require('node-api-headers').include_dir,
        sourcePath,
        '-o',
        temporary
      ],
      { stdio: 'inherit' }
    )
    renameSync(temporary, destination)
    return destination
  } finally {
    rmSync(temporary, { force: true })
  }
}

module.exports = { buildSelectionPanel, sourcePath }

if (require.main === module) buildSelectionPanel({ arch: process.argv[2] ?? process.arch })
