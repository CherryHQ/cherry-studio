const { execFileSync } = require('node:child_process')
const { copyFileSync, mkdirSync, renameSync, rmSync } = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '../..')
const sourcePath = path.join(__dirname, 'darwin/selectionPanel.mm')
const sourceFiles = [
  __filename,
  ...(process.platform === 'darwin'
    ? ['darwin/selectionPanel.mm']
    : process.platform === 'win32'
      ? [
          'binding.gyp',
          'win32/selectionPanel.cpp',
          'win32/cursors.rc',
          'win32/cursors/hand_grab.cur',
          'win32/cursors/hand_grabbing.cur',
          'win32/cursors/LICENSE'
        ]
      : []
  ).map((file) => path.join(__dirname, file))
]

function buildSelectionPanel({ platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'darwin' && platform !== 'win32') return
  if (process.platform !== platform) throw new Error('The selection panel addon requires a matching build host')
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported selection panel architecture: ${arch}`)

  const destination = path.join(projectRoot, 'resources/binaries', `${platform}-${arch}`, 'selection-panel.node')
  mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  try {
    if (platform === 'win32') {
      copyFileSync(
        path.join(__dirname, 'win32/cursors/LICENSE'),
        path.join(path.dirname(destination), 'selection-panel-license.txt')
      )
      execFileSync(
        process.execPath,
        [
          require.resolve('node-gyp/bin/node-gyp.js'),
          'rebuild',
          '--directory',
          __dirname,
          `--arch=${arch}`,
          `--target=${require('electron/package.json').version}`,
          '--dist-url=https://electronjs.org/headers'
        ],
        { stdio: 'inherit' }
      )
      copyFileSync(path.join(__dirname, 'build/Release/selection-panel.node'), temporary)
      renameSync(temporary, destination)
      return destination
    }
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
        '-framework',
        'ApplicationServices',
        '-framework',
        'QuartzCore',
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

module.exports = { buildSelectionPanel, sourceFiles }

if (require.main === module) buildSelectionPanel({ arch: process.argv[2] ?? process.arch })
