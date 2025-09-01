const fs = require('fs')
const path = require('path')
const os = require('os')
const zlib = require('zlib')
const tar = require('tar')
const { pipeline } = require('stream/promises')

async function downloadNpmPackage(packageName, url) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-download-'))
  const targetDir = path.join('./node_modules/', packageName)
  const filename = path.join(tempDir, packageName.replace('/', '-') + '.tgz')
  const extractDir = path.join(tempDir, 'extract')

  // Skip if directory already exists
  if (fs.existsSync(targetDir)) {
    console.log(`${targetDir} already exists, skipping download...`)
    return
  }

  try {
    console.log(`Downloading ${packageName}...`, url)

    // Download file using fetch API
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const fileStream = fs.createWriteStream(filename)
    await pipeline(response.body, fileStream)

    console.log(`Extracting ${filename}...`)

    // Create extraction directory
    fs.mkdirSync(extractDir, { recursive: true })

    // Extract tar.gz file using Node.js streams
    await pipeline(fs.createReadStream(filename), zlib.createGunzip(), tar.extract({ cwd: extractDir }))

    // Remove the downloaded file
    fs.rmSync(filename, { force: true })

    // Create target directory
    fs.mkdirSync(targetDir, { recursive: true })

    // Move extracted package contents to target directory
    const packageDir = path.join(extractDir, 'package')
    if (fs.existsSync(packageDir)) {
      fs.cpSync(packageDir, targetDir, { recursive: true })
    }
  } catch (error) {
    console.error(`Error processing ${packageName}: ${error.message}`)
    throw error
  } finally {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
}

module.exports = {
  downloadNpmPackage
}
