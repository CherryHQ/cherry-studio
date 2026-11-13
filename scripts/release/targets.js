const targets = [
  { platform: 'windows', os: 'windows-latest', arch: 'all' },
  { platform: 'mac', os: 'macos-15-intel', arch: 'x64' },
  { platform: 'mac', os: 'macos-latest', arch: 'arm64' },
  { platform: 'linux', os: 'ubuntu-latest', arch: 'x64' },
  { platform: 'linux', os: 'ubuntu-24.04-arm', arch: 'arm64' }
]

function getReleaseTargets(platform) {
  if (!['all', 'windows', 'mac', 'linux'].includes(platform))
    throw new Error(`Unsupported release platform: ${platform}`)
  return targets.filter((target) => platform === 'all' || target.platform === platform)
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(getReleaseTargets(process.argv[2])))
}

module.exports = { getReleaseTargets }
