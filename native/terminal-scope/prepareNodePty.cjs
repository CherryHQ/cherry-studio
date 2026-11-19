const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function prepareNodePty({ projectRoot, platform, arch }) {
  const moduleRoot = path.dirname(require.resolve('node-pty/package.json', { paths: [projectRoot] }))
  const target = path.join(moduleRoot, 'prebuilds', `${platform}-${arch}`)
  if (platform !== 'linux') {
    const binding = path.join(target, platform === 'win32' ? 'conpty.node' : 'pty.node')
    fs.accessSync(binding)
    if (platform === 'darwin') fs.chmodSync(path.join(target, 'spawn-helper'), 0o755)
    return
  }
  const temporary = fs.mkdtempSync(path.join(moduleRoot, '.terminal-build-'))
  try {
    for (const name of ['src', 'binding.gyp'])
      fs.cpSync(path.join(moduleRoot, name), path.join(temporary, name), { recursive: true })
    const addonApi = path.dirname(require.resolve('node-addon-api/package.json', { paths: [moduleRoot] }))
    fs.cpSync(addonApi, path.join(temporary, 'node_modules/node-addon-api'), { recursive: true })
    const nodeGyp = path.relative(projectRoot, require.resolve('node-gyp/bin/node-gyp.js', { paths: [projectRoot] }))
    if (nodeGyp.startsWith('..')) throw new Error('node-gyp must resolve inside the packaging checkout')
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--platform',
        `linux/${arch === 'arm64' ? 'arm64' : 'amd64'}`,
        '--mount',
        `type=bind,source=${projectRoot},target=/repo,readonly`,
        '--mount',
        `type=bind,source=${temporary},target=/work`,
        '--workdir',
        '/work',
        'node:24-bullseye',
        'node',
        `/repo/${nodeGyp}`,
        'rebuild',
        '--nodedir=/usr/local'
      ],
      { stdio: 'inherit' }
    )
    const binding = path.join(temporary, 'build/Release/pty.node')
    const elf = fs.readFileSync(binding)
    if (elf.toString('hex', 0, 4) !== '7f454c46' || elf.readUInt16LE(18) !== (arch === 'arm64' ? 183 : 62))
      throw new Error('node-pty build has the wrong target architecture')
    fs.mkdirSync(target, { recursive: true })
    fs.copyFileSync(binding, path.join(target, 'pty.node'))
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

module.exports = { prepareNodePty }
