const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const { execSync } = require('child_process')
const StreamZip = require('node-stream-zip')
const { downloadWithRedirects } = require('./download')

// Download sources
const GITCODE_RELEASE_BASE_URL = 'https://gitcode.com/CherryHQ/openclaw-releases/releases/download'
const GITHUB_RELEASE_BASE_URL = 'https://github.com/CherryHQ/openclaw/releases/download'
const GITHUB_API_LATEST_RELEASE = 'https://api.github.com/repos/CherryHQ/openclaw/releases/latest'
const DEFAULT_VERSION = 'v2026.3.11'
const API_TIMEOUT_MS = 5000

/**
 * Fetches the latest release version from GitHub API with timeout
 * @param {number} timeoutMs Timeout in milliseconds
 * @returns {Promise<string>} The latest version tag or DEFAULT_VERSION on failure
 */
async function getLatestVersion(timeoutMs = API_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const request = https.get(
      GITHUB_API_LATEST_RELEASE,
      {
        headers: {
          'User-Agent': 'cherry-studio-installer',
          Accept: 'application/vnd.github.v3+json'
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode !== 200) {
          console.warn(`GitHub API returned status ${res.statusCode}, using default version`)
          resolve(DEFAULT_VERSION)
          return
        }

        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.tag_name) {
              console.log(`Found latest version from GitHub: ${json.tag_name}`)
              resolve(json.tag_name)
            } else {
              console.warn('No tag_name in GitHub response, using default version')
              resolve(DEFAULT_VERSION)
            }
          } catch (e) {
            console.warn(`Failed to parse GitHub response: ${e.message}, using default version`)
            resolve(DEFAULT_VERSION)
          }
        })
      }
    )

    request.on('timeout', () => {
      console.warn(`GitHub API request timed out after ${timeoutMs}ms, using default version`)
      request.destroy()
      resolve(DEFAULT_VERSION)
    })

    request.on('error', (err) => {
      console.warn(`GitHub API request failed: ${err.message}, using default version`)
      resolve(DEFAULT_VERSION)
    })
  })
}

// Mapping of platform+arch to binary package name
const OPENCLAW_PACKAGES = {
  'darwin-arm64': 'openclaw-darwin-arm64.tar.gz',
  'darwin-x64': 'openclaw-darwin-x64.tar.gz',
  'win32-arm64': 'openclaw-windows-arm64.zip',
  'win32-x64': 'openclaw-windows-x64.zip',
  'linux-arm64': 'openclaw-linux-arm64.tar.gz',
  'linux-x64': 'openclaw-linux-x64.tar.gz'
}

/**
 * Downloads and extracts the openclaw binary for the specified platform and architecture
 * @param {string} platform Platform to download for
 * @param {string} arch Architecture to download for
 * @param {string} version Version to download
 * @param {boolean} useMirror Whether to use gitcode mirror (for China users)
 */
async function downloadOpenClawBinary(platform, arch, version = DEFAULT_VERSION, useMirror = false) {
  const platformKey = `${platform}-${arch}`
  const packageName = OPENCLAW_PACKAGES[platformKey]

  if (!packageName) {
    console.error(`No binary available for ${platformKey}`)
    return 101
  }

  const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
  fs.mkdirSync(binDir, { recursive: true })

  const baseUrl = useMirror ? GITCODE_RELEASE_BASE_URL : GITHUB_RELEASE_BASE_URL
  const downloadUrl = `${baseUrl}/${version}/${packageName}`
  const tempdir = os.tmpdir()
  const tempFilename = path.join(tempdir, packageName)
  const isTarGz = packageName.endsWith('.tar.gz')

  try {
    console.log(`Downloading openclaw ${version} for ${platformKey}...`)
    console.log(`URL: ${downloadUrl}`)

    await downloadWithRedirects(downloadUrl, tempFilename)

    console.log(`Extracting ${packageName} to ${binDir}...`)

    if (isTarGz) {
      const tempExtractDir = path.join(tempdir, `openclaw-extract-${Date.now()}`)
      fs.mkdirSync(tempExtractDir, { recursive: true })

      execSync(`tar -xzf "${tempFilename}" -C "${tempExtractDir}"`, { stdio: 'inherit' })

      // Find and move files to binDir
      const findAndMoveFiles = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            // Handle lib/ sidecar directory specially
            if (entry.name === 'lib') {
              const destLibDir = path.join(binDir, 'lib')
              fs.mkdirSync(destLibDir, { recursive: true })
              const libEntries = fs.readdirSync(fullPath)
              for (const libFile of libEntries) {
                const srcPath = path.join(fullPath, libFile)
                const destPath = path.join(destLibDir, libFile)
                fs.copyFileSync(srcPath, destPath)
                console.log(`Extracted lib/${libFile} -> ${destPath}`)
              }
            } else {
              findAndMoveFiles(fullPath)
            }
          } else {
            const filename = path.basename(entry.name)
            const outputPath = path.join(binDir, filename)
            fs.copyFileSync(fullPath, outputPath)
            console.log(`Extracted ${entry.name} -> ${outputPath}`)
            fs.chmodSync(outputPath, 0o755)
          }
        }
      }

      findAndMoveFiles(tempExtractDir)
      fs.rmSync(tempExtractDir, { recursive: true })
    } else {
      // Use StreamZip for zip files (Windows)
      const zip = new StreamZip.async({ file: tempFilename })
      const entries = await zip.entries()

      for (const entry of Object.values(entries)) {
        if (!entry.isDirectory) {
          const filename = path.basename(entry.name)
          const outputPath = path.join(binDir, filename)
          console.log(`Extracting ${entry.name} -> ${filename}`)
          await zip.extract(entry.name, outputPath)
          console.log(`Extracted ${entry.name} -> ${outputPath}`)
        }
      }

      await zip.close()
    }

    fs.unlinkSync(tempFilename)
    console.log(`Successfully installed openclaw ${version} for ${platform}-${arch}`)
    return 0
  } catch (error) {
    let retCode = 103

    console.error(`Error installing openclaw for ${platformKey}: ${error.message}`)

    if (fs.existsSync(tempFilename)) {
      fs.unlinkSync(tempFilename)
    }

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
 * Main function to install openclaw
 */
async function installOpenClaw() {
  const version = await getLatestVersion()
  const platform = os.platform()
  const arch = os.arch()

  // Check for mirror flag from environment variable
  const useMirror = process.env.OPENCLAW_USE_MIRROR === '1'

  console.log(`Installing openclaw ${version} for ${platform}-${arch}${useMirror ? ' (mirror)' : ''}...`)

  return await downloadOpenClawBinary(platform, arch, version, useMirror)
}

// Run the installation
installOpenClaw()
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
