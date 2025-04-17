const fs = require('fs')
const path = require('path')
const os = require('os')

function downloadNpmPackage(packageName, url) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-download-'))

  const targetDir = path.join('./node_modules/', packageName)
  const filename = packageName.replace('/', '-') + '.tgz'

  // Skip if directory already exists
  if (fs.existsSync(targetDir)) {
    console.log(`${targetDir} already exists, skipping download...`)
    return
  }

  try {
    console.log(`Downloading ${packageName}...`, url)
    const { execSync } = require('child_process')
    execSync(`curl --fail -o ${filename} ${url}`)

    console.log(`Extracting ${filename}...`)
    execSync(`tar -xvf ${filename}`)
    execSync(`rm -rf ${filename}`)
    execSync(`mkdir -p ${targetDir}`)
    execSync(`mv package/* ${targetDir}/`)
  } catch (error) {
    console.error(`Error processing ${packageName}: ${error.message}`)
    if (fs.existsSync(filename)) {
      fs.unlinkSync(filename)
    }
    throw error
  }

  fs.rmSync(tempDir, { recursive: true, force: true })
}

module.exports = {
  downloadNpmPackage
}
