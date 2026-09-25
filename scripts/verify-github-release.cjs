const fs = require('node:fs')
const crypto = require('node:crypto')
const { resolveReleaseProfile } = require('./release-profile.cjs')

async function main() {
  const manifest = JSON.parse(fs.readFileSync('release-manifest.json'))
  const profile = resolveReleaseProfile()
  if (
    manifest.profile !== profile.id ||
    manifest.features?.uar !== profile.uarEnabled ||
    manifest.source !== process.env.GITHUB_SHA ||
    [...(manifest.supportedPlatforms || [])].sort().join(',') !== [...profile.supportedPlatforms].sort().join(',')
  ) {
    throw new Error('Release manifest does not match the frozen source and feature profile')
  }
  if (manifest.pendingPlatforms?.length || manifest.artifacts.length !== profile.supportedPlatforms.length) {
    throw new Error('Release manifest does not contain the complete supported platform set')
  }
  for (const artifact of manifest.artifacts) {
    if (artifact.profile !== profile.id || artifact.source !== manifest.source) {
      throw new Error(`Installer metadata does not match release identity: ${artifact.name}`)
    }
    if (!artifact.url.startsWith(`https://github.com/${process.env.GITHUB_REPOSITORY}/releases/download/`)) {
      throw new Error(`Non-GitHub installer URL remains: ${artifact.name}`)
    }
    const response = await fetch(artifact.url, { signal: AbortSignal.timeout(600_000) })
    if (!response.ok) throw new Error(`Published installer unavailable: ${artifact.name}, HTTP ${response.status}`)
    if (!response.body) throw new Error(`Published installer returned no body: ${artifact.name}`)
    const digest = crypto.createHash('sha256')
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      digest.update(chunk)
    }
    if (size !== artifact.size) throw new Error(`Published installer size mismatch: ${artifact.name}`)
    if (digest.digest('hex') !== artifact.sha256) {
      throw new Error(`Published installer checksum mismatch: ${artifact.name}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
