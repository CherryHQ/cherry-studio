const fs = require('node:fs')
const { resolveReleaseProfile } = require('./release-profile.cjs')

const profile = resolveReleaseProfile()
const targets = [
  {
    runner: 'windows-2025',
    platform: 'win32',
    arch: 'x64',
    script: profile.uarEnabled ? 'build:win:x64:release:uar' : 'build:win:x64:release'
  },
  { runner: 'windows-11-arm', platform: 'win32', arch: 'arm64', script: 'build:win:arm64:release' },
  { runner: 'macos-15-intel', platform: 'darwin', arch: 'x64', script: 'build:mac:x64' },
  {
    runner: 'macos-15',
    platform: 'darwin',
    arch: 'arm64',
    script: profile.uarEnabled ? 'build:mac:arm64:release:uar' : 'build:mac:arm64'
  }
]
const manifest = require('../build/integration-artifacts.json')
const available = profile.supportedPlatforms
const manifestPlatforms = Array.isArray(manifest.platforms) ? manifest.platforms : []
const platformsMatch = profile.uarEnabled
  ? available.every((platform) => manifestPlatforms.includes(platform))
  : [...manifestPlatforms].sort().join(',') === [...available].sort().join(',')
if (!platformsMatch) {
  throw new Error(`Integration artifact platforms do not cover release profile ${profile.id}`)
}
for (const name of profile.nativeTools) {
  const tool = manifest.tools.find((entry) => entry.name === name)
  for (const platform of available) {
    if (!tool?.packages?.[platform]) throw new Error(`No published ${name} payload for ${platform}`)
  }
}
const selected = process.env.RELEASE_PLATFORMS
  ? process.env.RELEASE_PLATFORMS.split(',').map((value) => value.trim())
  : available
for (const platform of selected) {
  if (!available.includes(platform) || !targets.some((value) => `${value.platform}-${value.arch}` === platform))
    throw new Error(`No published native payload for ${platform}`)
}
const include = targets.filter((value) => selected.includes(`${value.platform}-${value.arch}`))
fs.appendFileSync(
  process.env.GITHUB_OUTPUT,
  `matrix=${JSON.stringify({ include })}\nplatforms=${selected.join(',')}\nprofile=${profile.id}\n`
)
