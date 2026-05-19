/**
 * Downloads mise binary for the target platform during build.
 * Called from before-pack.js to bundle the binary into resources/binaries/.
 *
 * Usage:
 *   node scripts/download-mise-binary.js <platform> <arch>
 *   e.g. node scripts/download-mise-binary.js darwin arm64
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const MISE_VERSION = '2026.5.11'

const MISE_PACKAGES = {
  'darwin-arm64': { file: `mise-v${MISE_VERSION}-macos-arm64`, binary: 'mise' },
  'darwin-x64': { file: `mise-v${MISE_VERSION}-macos-x64`, binary: 'mise' },
  'linux-x64': { file: `mise-v${MISE_VERSION}-linux-x64`, binary: 'mise' },
  'linux-arm64': { file: `mise-v${MISE_VERSION}-linux-arm64`, binary: 'mise' },
  'win32-x64': { file: `mise-v${MISE_VERSION}-windows-x64.exe`, binary: 'mise.exe' }
}

function downloadMise(platformKey, outputDir) {
  const pkg = MISE_PACKAGES[platformKey]
  if (!pkg) {
    console.warn(`[mise] No binary available for ${platformKey}, skipping`)
    return
  }

  const url = `https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/${pkg.file}`
  const destPath = path.join(outputDir, pkg.binary)

  console.log(`Downloading: ${url}`)
  execFileSync('curl', ['-fSL', '--retry', '3', '-o', destPath, url], { stdio: 'inherit' })

  if (!fs.existsSync(destPath)) {
    throw new Error(`Download failed: ${destPath} not found`)
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755)
  }
  console.log(`[mise] Installed ${pkg.binary} to ${destPath}`)
}

function main() {
  const platform = process.argv[2] || process.platform
  const arch = process.argv[3] || process.arch
  const platformKey = `${platform}-${arch}`

  console.log(`Downloading mise binary for ${platformKey}...`)

  const outputDir = path.join(__dirname, '..', 'resources', 'binaries', platformKey)
  fs.mkdirSync(outputDir, { recursive: true })

  downloadMise(platformKey, outputDir)

  fs.writeFileSync(path.join(outputDir, '.mise-version'), MISE_VERSION, 'utf8')

  console.log(`mise binary downloaded to ${outputDir}`)
}

try {
  main()
} catch (error) {
  console.error('Failed to download mise binary:', error.message)
}
