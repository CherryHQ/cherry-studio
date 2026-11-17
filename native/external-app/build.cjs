const { execFileSync } = require('node:child_process')
const { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const sourceFiles = [
  __filename,
  ...[
    'binding.gyp',
    'addon.cpp',
    'externalApp.h',
    'darwin/externalApp.mm',
    'win32/externalApp.cpp',
    'linux/externalApp.cpp',
    'linux/icons.cpp',
    'linux/Dockerfile'
  ].map((name) => path.join(__dirname, name))
]

function buildExternalApp({ platform = process.platform, arch = process.arch, packaging = false } = {}) {
  if (platform !== process.platform) throw new Error('External app addon requires a matching build host')
  if (!['darwin', 'win32', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported external app addon target: ${platform}-${arch}`)
  }
  const directory = path.join(root, 'resources/binaries', `${platform}-${arch}`)
  const destination = path.join(directory, 'external-app.node')
  if (
    !packaging &&
    existsSync(destination) &&
    sourceFiles.every((file) => statSync(file).mtimeMs < statSync(destination).mtimeMs)
  ) {
    return destination
  }
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(path.join(directory, '.external-app-'))
  const output = path.join(temporary, 'external-app.node')
  try {
    if (platform === 'linux' && (packaging || arch !== process.arch)) {
      cpSync(__dirname, path.join(temporary, 'source'), {
        recursive: true,
        filter: (file) => file !== path.join(__dirname, 'build')
      })
      cpSync(require('node-api-headers').include_dir, path.join(temporary, 'include/node-api-headers'), {
        recursive: true
      })
      cpSync(path.dirname(require.resolve('node-addon-api')), path.join(temporary, 'include/node-addon-api'), {
        recursive: true
      })
      const target = `linux/${arch === 'x64' ? 'amd64' : 'arm64'}`
      const tag = `cherry-external-app-build:${arch}`
      execFileSync(
        'docker',
        ['build', '--platform', target, '-f', path.join(__dirname, 'linux/Dockerfile'), '-t', tag, temporary],
        { stdio: 'inherit' }
      )
      execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '--platform',
          target,
          '--user',
          `${process.getuid()}:${process.getgid()}`,
          '--mount',
          `type=bind,source=${temporary},target=/out`,
          tag
        ],
        { stdio: 'inherit' }
      )
    } else {
      const args = [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', '--directory', __dirname, `--arch=${arch}`]
      if (platform === 'win32')
        args.push(`--target=${require('electron/package.json').version}`, '--dist-url=https://electronjs.org/headers')
      execFileSync(process.execPath, args, { stdio: 'inherit' })
      copyFileSync(path.join(__dirname, 'build/Release/external-app.node'), output)
    }
    renameSync(output, destination)
    return destination
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

module.exports = { buildExternalApp, sourceFiles }
if (require.main === module)
  buildExternalApp({ arch: process.argv[2] ?? process.arch, packaging: process.argv.includes('--packaging') })
