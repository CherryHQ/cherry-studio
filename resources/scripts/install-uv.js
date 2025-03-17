const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const https = require('https')
const tar = require('tar')

// Base URL for downloading uv binaries
const UV_RELEASE_BASE_URL = 'https://github.com/astral-sh/uv/releases/download'
const DEFAULT_UV_VERSION = '0.6.6'

// Mapping of platform+arch to binary package name
const UV_PACKAGES = {
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
  'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
  'win32-ia32': 'uv-i686-pc-windows-msvc.zip',
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'linux-ia32': 'uv-i686-unknown-linux-gnu.tar.gz',
  'linux-ppc64': 'uv-powerpc64-unknown-linux-gnu.tar.gz',
  'linux-ppc64le': 'uv-powerpc64le-unknown-linux-gnu.tar.gz',
  'linux-s390x': 'uv-s390x-unknown-linux-gnu.tar.gz',
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux-armv7l': 'uv-armv7-unknown-linux-gnueabihf.tar.gz',
  // MUSL variants
  'linux-musl-arm64': 'uv-aarch64-unknown-linux-musl.tar.gz',
  'linux-musl-ia32': 'uv-i686-unknown-linux-musl.tar.gz',
  'linux-musl-x64': 'uv-x86_64-unknown-linux-musl.tar.gz',
  'linux-musl-armv6l': 'uv-arm-unknown-linux-musleabihf.tar.gz',
  'linux-musl-armv7l': 'uv-armv7-unknown-linux-musleabihf.tar.gz'
}

/**
 * Downloads a file from a URL with redirect handling
 * @param {string} url The URL to download from
 * @param {string} destinationPath The path to save the file to
 * @returns {Promise<void>}
 */
async function downloadWithRedirects(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destinationPath)
    const request = (url) => {
      https
        .get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Handle redirect
            request(response.headers.location)
            return
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: ${response.statusCode}`))
            return
          }

          response.pipe(file)
          file.on('finish', () => {
            file.close(resolve)
          })
        })
        .on('error', reject)
    }

    request(url)
  })
}

/**
 * Fetches the latest version of uv from GitHub API
 * @returns {Promise<string>} The latest version tag (without 'v' prefix)
 */
async function getLatestUvVersion() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/astral-sh/uv/releases/latest',
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
          // Remove the 'v' prefix if present
          const version = release.tag_name.startsWith('v') ? release.tag_name.substring(1) : release.tag_name
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
    return false
  }

  // Create output directory structure
  const archDir = path.join(os.homedir(), '.cherrystudio', 'bin')
  // Ensure directories exist
  fs.mkdirSync(archDir, { recursive: true })

  // Download URL for the specific binary
  const downloadUrl = `${UV_RELEASE_BASE_URL}/${version}/${packageName}`
  const tempdir = os.tmpdir()
  const localFilename = path.join(tempdir, packageName)

  try {
    console.log(`Downloading uv ${version} for ${platformKey}...`)
    console.log(`URL: ${downloadUrl}`)

    // Use the new download function
    await downloadWithRedirects(downloadUrl, localFilename)

    // Extract files using tar
    console.log(`Extracting ${packageName} to ${archDir}...`)
    await tar.x({
      file: localFilename,
      cwd: tempdir,
      // zip 文件也可以用 tar 解压
      z: packageName.endsWith('.tar.gz') // 对于 .tar.gz 文件启用 gzip 解压
    })

    // Move files using Node.js fs
    const sourceDir = path.join(tempdir, packageName.split('.')[0])
    const files = fs.readdirSync(sourceDir)
    for (const file of files) {
      const sourcePath = path.join(sourceDir, file)
      const destPath = path.join(archDir, file)
      fs.renameSync(sourcePath, destPath)

      // Set executable permissions for non-Windows platforms
      if (platform !== 'win32') {
        try {
          // 755 permission: rwxr-xr-x
          fs.chmodSync(destPath, '755')
        } catch (error) {
          console.warn(`Warning: Failed to set executable permissions: ${error.message}`)
        }
      }
    }

    // Clean up
    fs.unlinkSync(localFilename)
    fs.rmdirSync(sourceDir, { recursive: true })

    console.log(`Successfully installed uv ${version} for ${platform}-${arch}`)
    return true
  } catch (error) {
    console.error(`Error installing uv for ${platformKey}: ${error.message}`)
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
 * Main function to install uv
 */
async function installUv() {
  const args = process.argv.slice(2)
  const specifiedVersion = args.find((arg) => !arg.startsWith('--'))

  // Get the latest version if no specific version is provided
  const version = specifiedVersion || (await getLatestUvVersion())
  console.log(`Using uv version: ${version}`)

  const specificPlatform = args.find((arg) => arg.startsWith('--platform='))?.split('=')[1]
  const specificArch = args.find((arg) => arg.startsWith('--arch='))?.split('=')[1]
  const specificMusl = args.includes('--musl')
  const installAll = args.includes('--all')

  if (installAll) {
    console.log(`Installing all uv ${version} binaries...`)
    for (const platformKey in UV_PACKAGES) {
      const [platformArch, musl] = platformKey.split('-musl-')
      if (musl) {
        const [platform, arch] = platformArch.split('-')
        await downloadUvBinary(platform, arch, version, true)
      } else {
        const [platform, arch] = platformKey.split('-')
        await downloadUvBinary(platform, arch, version, false)
      }
    }
  } else {
    const { platform, arch, isMusl } = detectPlatformAndArch()
    const targetPlatform = specificPlatform || platform
    const targetArch = specificArch || arch
    const targetMusl = specificMusl || isMusl

    console.log(`Installing uv ${version} for ${targetPlatform}-${targetArch}${targetMusl ? ' (MUSL)' : ''}...`)
    await downloadUvBinary(targetPlatform, targetArch, version, targetMusl)
  }
}

// Run the installation
installUv().catch((error) => {
  console.error('Installation failed:', error)
  process.exit(1)
})
