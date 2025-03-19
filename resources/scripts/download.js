const { ProxyAgent } = require('undici')
const { socksDispatcher } = require('fetch-socks')
const fs = require('fs')
const { pipeline } = require('stream/promises')

/**
 * Downloads a file from a URL with redirect handling
 * @param {string} url The URL to download from
 * @param {string} destinationPath The path to save the file to
 * @returns {Promise<void>}
 */
async function downloadWithRedirects(url, destinationPath) {
  const file = fs.createWriteStream(destinationPath)
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  let proxyAgent
  if (proxyUrl.startsWith('socks')) {
    const [protocol, address] = proxyUrl.split('://')
    const [host, port] = address.split(':')
    proxyAgent = socksDispatcher({
      host,
      port,
      type: protocol === 'socks5' ? 5 : 4
    })
  } else {
    proxyAgent = new ProxyAgent(proxyUrl)
  }
  const response = await fetch(url, {
    dispatcher: proxyAgent
  })
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  await pipeline(response.body, file)
}

module.exports = { downloadWithRedirects }
