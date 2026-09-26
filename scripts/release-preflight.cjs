const fs = require('node:fs')
const path = require('node:path')
const { resolveReleaseProfile } = require('./release-profile.cjs')

const root = path.resolve(__dirname, '..')
const version = require('../package.json').version
const profile = resolveReleaseProfile()
const requestedVersion = process.env.RELEASE_VERSION || version
const source = process.env.GITHUB_SHA
const selectedPlatforms = (process.env.RELEASE_PLATFORMS || profile.supportedPlatforms.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

if (requestedVersion !== version) {
  throw new Error(`Requested release ${requestedVersion} does not match package version ${version}`)
}
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Release version is not stable semver: ${version}`)
if (!/^[a-f0-9]{40}$/.test(source || '')) throw new Error('GITHUB_SHA must freeze one full source revision')
for (const platform of selectedPlatforms) {
  if (!profile.supportedPlatforms.includes(platform)) throw new Error(`Unknown release platform: ${platform}`)
}

const previousPath = path.join(root, 'release-manifest.json')
if (fs.existsSync(previousPath)) {
  const previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'))
  if (
    previous.version === version &&
    (previous.profile !== profile.id || previous.features?.uar !== profile.uarEnabled)
  ) {
    throw new Error(`Version ${version} is already assigned to a different release profile`)
  }
  const conflictingArtifact = previous.artifacts?.find(
    (artifact) => selectedPlatforms.includes(`${artifact.platform}-${artifact.arch}`) && artifact.source !== source
  )
  if (previous.version === version && conflictingArtifact) {
    throw new Error(
      `Platform ${conflictingArtifact.platform}-${conflictingArtifact.arch} is already published from ${conflictingArtifact.source}`
    )
  }
}

console.log(
  `Frozen release inputs: ${JSON.stringify({ version, profile: profile.id, source, platforms: selectedPlatforms })}`
)
