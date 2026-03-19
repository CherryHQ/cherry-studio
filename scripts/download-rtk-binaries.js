/**
 * Downloads rtk and jq binaries for the target platform during build.
 * Called from before-pack.js to bundle binaries into resources/binaries/.
 *
 * Usage:
 *   node scripts/download-rtk-binaries.js <platform> <arch>
 *   e.g. node scripts/download-rtk-binaries.js darwin arm64
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const RTK_VERSION = '0.30.1'
const JQ_VERSION = '1.8.1'

const RTK_PACKAGES = {
  'darwin-arm64': { file: 'rtk-aarch64-apple-darwin.tar.gz', binary: 'rtk' },
  'darwin-x64': { file: 'rtk-x86_64-apple-darwin.tar.gz', binary: 'rtk' },
  'linux-x64': { file: 'rtk-x86_64-unknown-linux-musl.tar.gz', binary: 'rtk' },
  'linux-arm64': { file: 'rtk-aarch64-unknown-linux-gnu.tar.gz', binary: 'rtk' },
  'win32-x64': { file: 'rtk-x86_64-pc-windows-msvc.zip', binary: 'rtk.exe' }
}

const JQ_PACKAGES = {
  'darwin-arm64': { file: 'jq-macos-arm64', binary: 'jq' },
  'darwin-x64': { file: 'jq-macos-amd64', binary: 'jq' },
  'linux-x64': { file: 'jq-linux-amd64', binary: 'jq' },
  'linux-arm64': { file: 'jq-linux-arm64', binary: 'jq' },
  'win32-x64': { file: 'jq-windows-amd64.exe', binary: 'jq.exe' }
}

function downloadFile(url, destPath) {
  console.log(`Downloading: ${url}`)
  execFileSync('curl', ['-fSL', '--retry', '3', '-o', destPath, url], { stdio: 'inherit' })
  if (!fs.existsSync(destPath)) {
    throw new Error(`Download failed: ${destPath} not found`)
  }
}

function downloadRtk(platformKey, outputDir) {
  const pkg = RTK_PACKAGES[platformKey]
  if (!pkg) {
    console.warn(`[rtk] No binary available for ${platformKey}, skipping`)
    return
  }

  const url = `https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/${pkg.file}`
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-'))
  const tempFile = path.join(tempDir, pkg.file)

  try {
    downloadFile(url, tempFile)

    if (pkg.file.endsWith('.tar.gz')) {
      execFileSync('tar', ['-xzf', tempFile, '-C', tempDir], { stdio: 'inherit' })
    } else if (pkg.file.endsWith('.zip')) {
      execFileSync('unzip', ['-o', tempFile, '-d', tempDir], { stdio: 'inherit' })
    }

    // rtk archives extract the binary at the root level
    const srcPath = path.join(tempDir, pkg.binary)
    if (!fs.existsSync(srcPath)) {
      throw new Error(`rtk binary '${pkg.binary}' not found in extracted archive`)
    }

    const destPath = path.join(outputDir, pkg.binary)
    fs.copyFileSync(srcPath, destPath)
    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, 0o755)
    }
    console.log(`[rtk] Installed ${pkg.binary} to ${destPath}`)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function downloadJq(platformKey, outputDir) {
  const pkg = JQ_PACKAGES[platformKey]
  if (!pkg) {
    console.warn(`[jq] No binary available for ${platformKey}, skipping`)
    return
  }

  const url = `https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/${pkg.file}`
  const destPath = path.join(outputDir, pkg.binary)

  downloadFile(url, destPath)
  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755)
  }
  console.log(`[jq] Installed ${pkg.binary} to ${destPath}`)
}

function main() {
  const platform = process.argv[2] || process.platform
  const arch = process.argv[3] || process.arch
  const platformKey = `${platform}-${arch}`

  console.log(`Downloading rtk and jq binaries for ${platformKey}...`)

  const outputDir = path.join(__dirname, '..', 'resources', 'binaries', platformKey)
  fs.mkdirSync(outputDir, { recursive: true })

  downloadRtk(platformKey, outputDir)
  downloadJq(platformKey, outputDir)

  console.log(`All binaries downloaded to ${outputDir}`)
}

try {
  main()
} catch (error) {
  console.error('Failed to download binaries:', error.message)
  // Non-fatal: don't block the build if binary download fails
}
