const fs = require('node:fs')
const path = require('node:path')

const { resolveReleaseProfile } = require('./release-profile.cjs')

/** Produced from successful native release jobs, then committed before installer packaging. */
function loadIntegrationBinaries({ required = false } = {}) {
  const filename = path.join(__dirname, '..', 'build', 'integration-artifacts.json')
  if (!fs.existsSync(filename)) {
    if (required)
      throw new Error(
        'Native integration artifacts are not pinned. Publish the integration tool payload before building installers.'
      )
    return []
  }
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const profile = resolveReleaseProfile()
  const requiredTools = profile.nativeTools
  for (const name of requiredTools) {
    const tool = manifest.tools.find((entry) => entry.name === name)
    if (!tool) throw new Error(`Integration manifest is missing ${name}`)
    const platforms = name === 'uar-sidecar' ? Object.keys(tool.packages) : profile.supportedPlatforms
    for (const platform of platforms) {
      const asset = tool.packages[platform]
      if (!asset || !asset.url.startsWith('https://') || !/^[a-f0-9]{64}$/.test(asset.sha256))
        throw new Error(`Unpinned integration artifact: ${name} ${platform}`)
    }
  }
  return manifest.tools
    .filter((tool) => requiredTools.includes(tool.name))
    .map((tool) => ({ ...tool, required, versionFile: `.${tool.name}-version` }))
}

module.exports = { loadIntegrationBinaries }
