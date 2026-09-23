const fs = require('node:fs')
const targets = [
  { runner: 'windows-2025', platform: 'win32', arch: 'x64', script: 'build:win:x64:release' },
  { runner: 'windows-11-arm', platform: 'win32', arch: 'arm64', script: 'build:win:arm64:release' },
  { runner: 'macos-15-intel', platform: 'darwin', arch: 'x64', script: 'build:mac:x64' },
  { runner: 'macos-15', platform: 'darwin', arch: 'arm64', script: 'build:mac:arm64' },
  { runner: 'ubuntu-24.04', platform: 'linux', arch: 'x64', script: 'build:linux:x64' },
  { runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64', script: 'build:linux:arm64' }
]
const manifest = require('../build/integration-artifacts.json')
const available = manifest.platforms || targets.map(({ platform, arch }) => `${platform}-${arch}`)
const selected = process.env.RELEASE_PLATFORMS
  ? process.env.RELEASE_PLATFORMS.split(',').map((value) => value.trim())
  : available
for (const platform of selected) {
  if (!available.includes(platform) || !targets.some((value) => `${value.platform}-${value.arch}` === platform))
    throw new Error(`No published native payload for ${platform}`)
}
const include = targets.filter((value) => selected.includes(`${value.platform}-${value.arch}`))
fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include })}\nplatforms=${selected.join(',')}\n`)
