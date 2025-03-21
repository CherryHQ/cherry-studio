const { ProxyAgent } = require('undici')
const { SocksProxyAgent } = require('socks-proxy-agent')
const https = require('https')
const fs = require('fs')
const { pipeline } = require('stream/promises')

/**
 * Downloads a file from a URL with redirect handling
 * @param {string} url The URL to download from
 * @param {string} destinationPath The path to save the file to
 * @returns {Promise<void>} Promise that resolves when download is complete
 */
async function downloadWithRedirects(url, destinationPath) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  if (proxyUrl.startsWith('socks')) {
    const proxyAgent = new SocksProxyAgent(proxyUrl)
    return new Promise((resolve, reject) => {
      const request = (url) => {
        https.get(url, { agent: proxyAgent }, (response) => {
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
        }).on('error', (err) => {
          reject(err)
        })
      }
      request(url)
    })
  } else {
    const proxyAgent = new ProxyAgent(proxyUrl)
    const response = await fetch(url, {
      dispatcher: proxyAgent
    })
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }
    const file = fs.createWriteStream(destinationPath)
    await pipeline(response.body, file)
  }
}

module.exports = { downloadWithRedirects }
