const https = require('https')
const fs = require('fs')

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

module.exports = { downloadWithRedirects }
