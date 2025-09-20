const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

/**
 * Downloads a file from a URL with redirect handling
 * @param {string} url The URL to download from
 * @param {string} destinationPath The path to save the file to
 * @returns {Promise<void>} Promise that resolves when download is complete
 */
async function downloadWithRedirects(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      https
        .get(url, (response) => {
          if (response.statusCode == 301 || response.statusCode == 302) {
            request(response.headers.location)
            return
          }
          if (response.statusCode !== 200) {
            reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`))
            return
          }
          const file = fs.createWriteStream(destinationPath)
          response.pipe(file)
          file.on('finish', () => resolve())
        })
        .on('error', (err) => {
          reject(err)
        })
    }
    request(url)
  })
}

/**
 * Downloads a file using PowerShell Invoke-WebRequest command
 * @param {string} url The URL to download from
 * @param {string} destinationPath The path to save the file to
 * @returns {Promise<boolean>} Promise that resolves to true if download succeeds
 */
async function downloadWithPowerShell(url, destinationPath) {
  return new Promise((resolve, reject) => {
    try {
      // Only support windows platform for PowerShell download
      if (process.platform !== 'win32') {
        return reject(new Error('PowerShell download is only supported on Windows'))
      }

      const outputDir = path.dirname(destinationPath)
      fs.mkdirSync(outputDir, { recursive: true })

      // PowerShell command to download the file with progress disabled for faster download
      const psCommand = `powershell -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest '${url}' -OutFile '${destinationPath}'"`

      console.log(`Downloading with PowerShell: ${url}`)
      execSync(psCommand, { stdio: 'inherit' })

      if (fs.existsSync(destinationPath)) {
        console.log(`Download completed: ${destinationPath}`)
        resolve(true)
      } else {
        reject(new Error('Download failed: File not found after download'))
      }
    } catch (error) {
      reject(new Error(`PowerShell download failed: ${error.message}`))
    }
  })
}

module.exports = { downloadWithRedirects, downloadWithPowerShell }
