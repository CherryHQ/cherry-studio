/**
 * Downloads mise binary for the target platform during build.
 * Called from before-pack.js to bundle the binary into resources/binaries/.
 *
 * Usage:
 *   node scripts/download-mise-binary.js <platform> <arch>
 *   e.g. node scripts/download-mise-binary.js darwin arm64
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const MISE_VERSION = '2026.5.11'

const MISE_PACKAGES = {
  'darwin-arm64': {
    file: `mise-v${MISE_VERSION}-macos-arm64`,
    binary: 'mise',
    sha256: '1f404ecafe0a2ecc34bae661661b99e9cb06dba0f03f0e906ae4528b57d37e6c'
  },
  'darwin-x64': {
    file: `mise-v${MISE_VERSION}-macos-x64`,
    binary: 'mise',
    sha256: '0a2383b0ca7e3cea2e68796917506e79b74f06a1a64501c7f83e14f2520b43f0'
  },
  'linux-x64': {
    file: `mise-v${MISE_VERSION}-linux-x64`,
    binary: 'mise',
    sha256: '9bb41ae4dbe2bcdfdbe36cf3c737a8bdb72035c03af3b7218a70780988f62b9b'
  },
  'linux-arm64': {
    file: `mise-v${MISE_VERSION}-linux-arm64`,
    binary: 'mise',
    sha256: 'a588ea2fec11f6383bd24998f5ede89100f70f1f47943b9ea30c88e4048ea91f'
  },
  'win32-x64': {
    file: `mise-v${MISE_VERSION}-windows-x64.exe`,
    binary: 'mise.exe',
    sha256: '580401ddbc9977f94db85bbea51323f5aea6953dbe2a452cb49c2adcf1d8f7c0'
  },
  'win32-arm64': {
    file: `mise-v${MISE_VERSION}-windows-arm64.exe`,
    binary: 'mise.exe',
    sha256: 'd29b9909d2aa1c85e4a43b9b4be24b2015423628ae29b15d7e677ab00fccd47e'
  }
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

  const hash = crypto.createHash('sha256').update(fs.readFileSync(destPath)).digest('hex')
  if (hash !== pkg.sha256) {
    fs.unlinkSync(destPath)
    throw new Error(`SHA256 mismatch for ${pkg.file}: expected ${pkg.sha256}, got ${hash}`)
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755)
  }
  console.log(`[mise] Verified and installed ${pkg.binary} to ${destPath}`)
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
  process.exit(1)
}
