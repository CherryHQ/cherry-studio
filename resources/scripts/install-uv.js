const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const StreamZip = require('node-stream-zip')
const { downloadWithRedirects } = require('./download')

// Base URL for downloading uv binaries
const UV_RELEASE_BASE_URL = 'https://gitcode.com/CherryHQ/uv/releases/download'
const DEFAULT_UV_VERSION = '0.7.13'

// Mapping of platform+arch to binary package name
const UV_PACKAGES = {
  'darwin-arm64': 'uv-aarch64-apple-darwin.zip',
  'darwin-x64': 'uv-x86_64-apple-darwin.zip',
  'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
  'win32-ia32': 'uv-i686-pc-windows-msvc.zip',
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.zip',
  'linux-ia32': 'uv-i686-unknown-linux-gnu.zip',
  'linux-ppc64': 'uv-powerpc64-unknown-linux-gnu.zip',
  'linux-ppc64le': 'uv-powerpc64le-unknown-linux-gnu.zip',
  'linux-s390x': 'uv-s390x-unknown-linux-gnu.zip',
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.zip',
  'linux-armv7l': 'uv-armv7-unknown-linux-gnueabihf.zip',
  // MUSL variants
  'linux-musl-arm64': 'uv-aarch64-unknown-linux-musl.zip',
  'linux-musl-ia32': 'uv-i686-unknown-linux-musl.zip',
  'linux-musl-x64': 'uv-x86_64-unknown-linux-musl.zip',
  'linux-musl-armv6l': 'uv-arm-unknown-linux-musleabihf.zip',
  'linux-musl-armv7l': 'uv-armv7-unknown-linux-musleabihf.zip'
}

/**
 * Downloads and extracts the uv binary for the specified platform and architecture
 * @param {string} platform Platform to download for (e.g., 'darwin', 'win32', 'linux')
 * @param {string} arch Architecture to download for (e.g., 'x64', 'arm64')
 * @param {string} version Version of uv to download
 * @param {boolean} isMusl Whether to use MUSL variant for Linux
 */
async function downloadUvBinary(platform, arch, version = DEFAULT_UV_VERSION, isMusl = false) {
  const platformKey = isMusl ? `${platform}-musl-${arch}` : `${platform}-${arch}`
  const packageName = UV_PACKAGES[platformKey]

  if (!packageName) {
    console.error(`No binary available for ${platformKey}`)
    return 101
  }

  // Create output directory structure
  const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
  // Ensure directories exist
  fs.mkdirSync(binDir, { recursive: true })

  // Download URL for the specific binary
  const downloadUrl = `${UV_RELEASE_BASE_URL}/${version}/${packageName}`
  const tempdir = os.tmpdir()
  const tempFilename = path.join(tempdir, packageName)

  try {
    console.log(`Downloading uv ${version} for ${platformKey}...`)
    console.log(`URL: ${downloadUrl}`)

    await downloadWithRedirects(downloadUrl, tempFilename)

    console.log(`Extracting ${packageName} to ${binDir}...`)

    const zip = new StreamZip.async({ file: tempFilename })

    // Get all entries in the zip file
    const entries = await zip.entries()

    // Extract files directly to binDir, flattening the directory structure
    for (const entry of Object.values(entries)) {
      if (!entry.isDirectory) {
        // Get just the filename without path
        const filename = path.basename(entry.name)
        const outputPath = path.join(binDir, filename)

        console.log(`Extracting ${entry.name} -> ${filename}`)
        await zip.extract(entry.name, outputPath)
        // Make executable files executable on Unix-like systems
        if (platform !== 'win32') {
          try {
            fs.chmodSync(outputPath, 0o755)
          } catch (chmodError) {
            console.error(`Warning: Failed to set executable permissions on ${filename}`)
            return 102
          }
        }
        console.log(`Extracted ${entry.name} -> ${outputPath}`)
      }
    }

    await zip.close()
    fs.unlinkSync(tempFilename)
    console.log(`Successfully installed uv ${version} for ${platform}-${arch}`)
    return 0
  } catch (error) {
    let retCode = 103

    console.error(`Error installing uv for ${platformKey}: ${error.message}`)

    if (fs.existsSync(tempFilename)) {
      fs.unlinkSync(tempFilename)
    }

    // Check if binDir is empty and remove it if so
    try {
      const files = fs.readdirSync(binDir)
      if (files.length === 0) {
        fs.rmSync(binDir, { recursive: true })
        console.log(`Removed empty directory: ${binDir}`)
      }
    } catch (cleanupError) {
      console.warn(`Warning: Failed to clean up directory: ${cleanupError.message}`)
      retCode = 104
    }

    return retCode
  }
}

/**
 * Detects current platform and architecture
 */
function detectPlatformAndArch() {
  const platform = os.platform()
  const arch = os.arch()
  const isMusl = platform === 'linux' && detectIsMusl()

  return { platform, arch, isMusl }
}

/**
 * Attempts to detect if running on MUSL libc
 */
function detectIsMusl() {
  try {
    // Simple check for Alpine Linux which uses MUSL
    const output = execSync('cat /etc/os-release').toString()
    return output.toLowerCase().includes('alpine')
  } catch (error) {
    return false
  }
}

/**
 * Main function to install uv
 */
async function installUv() {
  // Get the latest version if no specific version is provided
  const version = DEFAULT_UV_VERSION
  console.log(`Using uv version: ${version}`)

  const { platform, arch, isMusl } = detectPlatformAndArch()

  console.log(`Installing uv ${version} for ${platform}-${arch}${isMusl ? ' (MUSL)' : ''}...`)

  return await downloadUvBinary(platform, arch, version, isMusl)
}

// Run the installation
installUv()
  .then((retCode) => {
    if (retCode === 0) {
      console.log('Installation successful')
      process.exit(0)
    } else {
      console.error('Installation failed')
      process.exit(retCode)
    }
  })
  .catch((error) => {
    console.error('Installation failed:', error)
    process.exit(100)
  })
