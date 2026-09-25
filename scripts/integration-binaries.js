const fs = require('node:fs')
const path = require('node:path')

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
  const requiredTools = ['compass', 'rust-mcp-filesystem', 'prometheus', 'pk', 'node', 'uar-sidecar']
  if (required) requiredTools.push('liter-llm')
  for (const name of requiredTools) {
    const tool = manifest.tools.find((entry) => entry.name === name)
    if (!tool) throw new Error(`Integration manifest is missing ${name}`)
    for (const platform of manifest.platforms || [
      'darwin-x64',
      'darwin-arm64',
      'win32-x64',
      'win32-arm64',
      'linux-x64',
      'linux-arm64'
    ]) {
      const asset = tool.packages[platform]
      if (!asset || !asset.url.startsWith('https://') || !/^[a-f0-9]{64}$/.test(asset.sha256))
        throw new Error(`Unpinned integration artifact: ${name} ${platform}`)
    }
  }
  return manifest.tools.map((tool) => ({ ...tool, required: true, versionFile: `.${tool.name}-version` }))
}

module.exports = { loadIntegrationBinaries }
