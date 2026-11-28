const macRunner = ['self-hosted', 'mac-studio']
const targets = [
  { platform: 'windows', runner: 'windows-latest', arch: 'all' },
  { platform: 'mac', runner: macRunner, arch: 'x64' },
  { platform: 'mac', runner: macRunner, arch: 'arm64' },
  { platform: 'linux', runner: 'ubuntu-latest', arch: 'x64' },
  { platform: 'linux', runner: 'ubuntu-latest', arch: 'arm64' }
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
