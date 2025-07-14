const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const StreamZip = require('node-stream-zip')
const { downloadWithRedirects } = require('./download')

// Base URL for downloading bun binaries
const BUN_RELEASE_BASE_URL = 'https://gitcode.com/CherryHQ/bun/releases/download'
const DEFAULT_BUN_VERSION = '1.2.17' // Default fallback version

// Mapping of platform+arch to binary package name
const BUN_PACKAGES = {
  'darwin-arm64': 'bun-darwin-aarch64.zip',
  'darwin-x64': 'bun-darwin-x64.zip',
  'win32-x64': 'bun-windows-x64.zip',
  'win32-x64-baseline': 'bun-windows-x64-baseline.zip',
  'win32-arm64': 'bun-windows-x64.zip',
  'win32-arm64-baseline': 'bun-windows-x64-baseline.zip',
  'linux-x64': 'bun-linux-x64.zip',
  'linux-x64-baseline': 'bun-linux-x64-baseline.zip',
  'linux-arm64': 'bun-linux-aarch64.zip',
  // MUSL variants
  'linux-musl-x64': 'bun-linux-x64-musl.zip',
  'linux-musl-x64-baseline': 'bun-linux-x64-musl-baseline.zip',
  'linux-musl-arm64': 'bun-linux-aarch64-musl.zip'
}

/**
 * Downloads and extracts the bun binary for the specified platform and architecture
 * @param {string} platform Platform to download for (e.g., 'darwin', 'win32', 'linux')
 * @param {string} arch Architecture to download for (e.g., 'x64', 'arm64')
 * @param {string} version Version of bun to download
 * @param {boolean} isMusl Whether to use MUSL variant for Linux
 * @param {boolean} isBaseline Whether to use baseline variant
 */
async function downloadBunBinary(platform, arch, version = DEFAULT_BUN_VERSION, isMusl = false, isBaseline = false) {
  let platformKey = isMusl ? `${platform}-musl-${arch}` : `${platform}-${arch}`
  if (isBaseline) {
    platformKey += '-baseline'
  }
  const packageName = BUN_PACKAGES[platformKey]

  if (!packageName) {
    console.error(`No binary available for ${platformKey}`)
    return 101
  }

  // Create output directory structure
  const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
  // Ensure directories exist
  fs.mkdirSync(binDir, { recursive: true })

  // Download URL for the specific binary
  const downloadUrl = `${BUN_RELEASE_BASE_URL}/bun-v${version}/${packageName}`
  const tempdir = os.tmpdir()
  // Create a temporary file for the downloaded binary
  const tempFilename = path.join(tempdir, packageName)

  try {
    console.log(`Downloading bun ${version} for ${platformKey}...`)
    console.log(`URL: ${downloadUrl}`)

    // Use the new download function
    await downloadWithRedirects(downloadUrl, tempFilename)

    // Extract the zip file using adm-zip
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

    // Clean up
    fs.unlinkSync(tempFilename)
    console.log(`Successfully installed bun ${version} for ${platformKey}`)
    return 0
  } catch (error) {
    let retCode = 103

    console.error(`Error installing bun for ${platformKey}: ${error.message}`)
    // Clean up temporary file if it exists
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
  const isBaseline = platform === 'win32'

  return { platform, arch, isMusl, isBaseline }
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
 * Main function to install bun
 */
async function installBun() {
  // Get the latest version if no specific version is provided
  const version = DEFAULT_BUN_VERSION
  console.log(`Using bun version: ${version}`)

  const { platform, arch, isMusl, isBaseline } = detectPlatformAndArch()

  console.log(
    `Installing bun ${version} for ${platform}-${arch}${isMusl ? ' (MUSL)' : ''}${isBaseline ? ' (baseline)' : ''}...`
  )

  return await downloadBunBinary(platform, arch, version, isMusl, isBaseline)
}

// Run the installation
installBun()
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
