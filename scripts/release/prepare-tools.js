const crypto = require('node:crypto')
const path = require('node:path')
const { PACKAGING_DOWNLOAD_VERSION, prepareTools, TOOLS } = require('../download-binaries')

function getToolTargets(platform, arch) {
  const platforms = { windows: 'win32', mac: 'darwin', linux: 'linux' }
  if (
    !Object.hasOwn(platforms, platform) ||
    !(['x64', 'arm64'].includes(arch) || (platform === 'windows' && arch === 'all'))
  ) {
    throw new Error(`Unsupported tool target: ${platform}-${arch}`)
  }
  return (arch === 'all' ? ['x64', 'arm64'] : [arch]).map((targetArch) => ({
    platform: platforms[platform],
    arch: targetArch
  }))
}

function getToolCacheInfo(platform, arch, runnerToolCache) {
  if (!runnerToolCache) throw new Error('RUNNER_TOOL_CACHE is required for the packaging asset cache')
  const targets = getToolTargets(platform, arch)
  const manifest = targets.flatMap((target) =>
    TOOLS.flatMap((tool) => {
      const pkg = tool.packages[`${target.platform}-${target.arch}`]
      return pkg ? [{ name: tool.name, version: tool.version, ...pkg }] : []
    })
  )
  const digest = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
  const prefix = `release-tools-v${PACKAGING_DOWNLOAD_VERSION}-${platform}-${arch}-`
  const root = path.join(runnerToolCache, `cherry-binary-assets-v${PACKAGING_DOWNLOAD_VERSION}`, `${platform}-${arch}`)
  return { root, path: path.join(root, 'complete'), key: prefix + digest, prefix }
}

async function main() {
  const [command, platform, arch] = process.argv.slice(2)
  if (command === 'cache-info') {
    const info = getToolCacheInfo(platform, arch, process.env.RUNNER_TOOL_CACHE)
    for (const [name, value] of Object.entries(info)) process.stdout.write(`${name}=${value}\n`)
  } else if (command === 'prepare') {
    for (const target of getToolTargets(platform, arch)) await prepareTools(target.platform, target.arch)
  } else
    throw new Error(
      'Usage: node scripts/release/prepare-tools.js <cache-info|prepare> <windows|mac|linux> <x64|arm64|all>'
    )
}

module.exports = { getToolTargets, getToolCacheInfo }

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
