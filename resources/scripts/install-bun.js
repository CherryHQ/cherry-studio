const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const https = require('https')

// Base URL for downloading bun binaries
const BUN_RELEASE_BASE_URL = 'https://github.com/oven-sh/bun/releases/download'
const DEFAULT_BUN_VERSION = '1.2.5' // Default fallback version

// Mapping of platform+arch to binary package name
const BUN_PACKAGES = {
  'darwin-arm64': 'bun-darwin-aarch64.zip',
  'darwin-x64': 'bun-darwin-x64.zip',
  'win32-x64': 'bun-windows-x64.zip',
  'win32-x64-baseline': 'bun-windows-x64-baseline.zip',
  'linux-x64': 'bun-linux-x64.zip',
  'linux-x64-baseline': 'bun-linux-x64-baseline.zip',
  'linux-arm64': 'bun-linux-aarch64.zip',
  // MUSL variants
  'linux-musl-x64': 'bun-linux-x64-musl.zip',
  'linux-musl-x64-baseline': 'bun-linux-x64-musl-baseline.zip',
  'linux-musl-arm64': 'bun-linux-aarch64-musl.zip'
}

/**
 * Fetches the latest version of bun from GitHub API
 * @returns {Promise<string>} The latest version tag (without 'bun-v' prefix)
 */
async function getLatestBunVersion() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/oven-sh/bun/releases/latest',
      headers: {
        'User-Agent': 'cherry-studio-install-script'
      }
    }

    const req = https.get(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed with status code ${res.statusCode}`))
        return
      }

      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const release = JSON.parse(data)
          // Remove the 'bun-v' prefix if present
          const version = release.tag_name.startsWith('bun-v')
            ? release.tag_name.substring(5)
            : release.tag_name.startsWith('v')
              ? release.tag_name.substring(1)
              : release.tag_name
          resolve(version)
        } catch (error) {
          reject(new Error(`Failed to parse GitHub API response: ${error.message}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(new Error(`Failed to fetch latest version: ${error.message}`))
    })

    req.end()
  })
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
    return false
  }

  // Create output directory structure
  const archDir = path.join(os.homedir(), '.cherrystudio', 'bin')
  // Ensure directories exist
  fs.mkdirSync(archDir, { recursive: true })

  // Download URL for the specific binary
  const downloadUrl = `${BUN_RELEASE_BASE_URL}/bun-v${version}/${packageName}`
  const tempdir = os.tmpdir()
  // Create a temporary file for the downloaded binary
  const localFilename = path.join(tempdir, packageName)

  try {
    console.log(`Downloading bun ${version} for ${platformKey}...`)
    console.log(`URL: ${downloadUrl}`)

    // Download the file
    execSync(`curl --fail -L -o "${localFilename}" "${downloadUrl}"`, { stdio: 'inherit' })

    // Extract the zip file
    console.log(`Extracting ${packageName} to ${archDir}...`)
    execSync(`unzip -o "${localFilename}" -d "${tempdir}"`, { stdio: 'inherit' })
    execSync(`mv ${tempdir}/${packageName.split('.')[0]}/* ${archDir}/`, { stdio: 'inherit' })

    // Clean up the downloaded file
    fs.unlinkSync(localFilename)

    console.log(`Successfully installed bun ${version} for ${platformKey}`)
    return true
  } catch (error) {
    console.error(`Error installing bun for ${platformKey}: ${error.message}`)
    if (fs.existsSync(localFilename)) {
      fs.unlinkSync(localFilename)
    }
    return false
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
 * Main function to install bun
 */
async function installBun() {
  const args = process.argv.slice(2)
  const specifiedVersion = args.find((arg) => !arg.startsWith('--'))

  // Get the latest version if no specific version is provided
  const version = specifiedVersion || (await getLatestBunVersion())
  console.log(`Using bun version: ${version}`)

  const specificPlatform = args.find((arg) => arg.startsWith('--platform='))?.split('=')[1]
  const specificArch = args.find((arg) => arg.startsWith('--arch='))?.split('=')[1]
  const specificMusl = args.includes('--musl')
  const specificBaseline = args.includes('--baseline')
  const installAll = args.includes('--all')

  if (installAll) {
    console.log(`Installing all bun ${version} binaries...`)
    for (const platformKey in BUN_PACKAGES) {
      let platform,
        arch,
        isMusl = false,
        isBaseline = false

      if (platformKey.includes('-musl-')) {
        const [platformPart, archPart] = platformKey.split('-musl-')
        platform = platformPart
        isMusl = true

        if (archPart.includes('-baseline')) {
          ;[arch] = archPart.split('-baseline')
          isBaseline = true
        } else {
          arch = archPart
        }
      } else if (platformKey.includes('-baseline')) {
        const [platformPart, archPart] = platformKey.split('-')
        platform = platformPart
        arch = archPart.replace('-baseline', '')
        isBaseline = true
      } else {
        ;[platform, arch] = platformKey.split('-')
      }

      await downloadBunBinary(platform, arch, version, isMusl, isBaseline)
    }
  } else {
    const { platform, arch, isMusl } = detectPlatformAndArch()
    const targetPlatform = specificPlatform || platform
    const targetArch = specificArch || arch
    const targetMusl = specificMusl || isMusl
    const targetBaseline = specificBaseline || false

    console.log(
      `Installing bun ${version} for ${targetPlatform}-${targetArch}${targetMusl ? ' (MUSL)' : ''}${targetBaseline ? ' (baseline)' : ''}...`
    )
    await downloadBunBinary(targetPlatform, targetArch, version, targetMusl, targetBaseline)
  }
}

// Run the installation
installBun().catch((error) => {
  console.error('Installation failed:', error)
  process.exit(1)
})
