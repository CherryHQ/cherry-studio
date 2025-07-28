/* eslint-disable @typescript-eslint/ban-ts-comment */
// This script is designed to make the Electron webview environment appear more like a standard browser,
// bypassing advanced fingerprinting techniques used by services like Cloudflare.

// --- Basic Mocks ---

// 1. Deceive navigator.webdriver detection
if (navigator.webdriver) {
  Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
}

// 2. Mock the chrome object
// @ts-ignore
window.chrome = window.chrome || {}
// @ts-ignore
window.chrome.runtime = window.chrome.runtime || {}

// 3. Standardize language properties
Object.defineProperty(navigator, 'language', { get: () => 'en-US', configurable: true })
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true })

// --- Advanced Fingerprint Spoofing ---

// 4. Mock plugins and mimeTypes to appear more authentic
const mockPlugins = [
  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
  { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
]

const mockMimeTypes = [
  { type: 'application/pdf', suffixes: 'pdf', description: '' },
  { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
  { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
  { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' }
]

// @ts-ignore
navigator.plugins = mockPlugins
// @ts-ignore
navigator.mimeTypes = mockMimeTypes

// 5. Spoof WebGL vendor and renderer to avoid hardware fingerprinting
try {
  const getParameter = WebGLRenderingContext.prototype.getParameter
  WebGLRenderingContext.prototype.getParameter = function (parameter) {
    // UNMASKED_VENDOR_WEBGL
    if (parameter === 37445) {
      return 'Intel Inc.'
    }
    // UNMASKED_RENDERER_WEBGL
    if (parameter === 37446) {
      return 'Intel Iris OpenGL Engine'
    }
    return getParameter.apply(this, [parameter])
  }
} catch (e) {
  // Ignore errors
}

// 6. Mask function toString to prevent detection of patched functions
const originalToString = Function.prototype.toString
Function.prototype.toString = function () {
  if (this === Function.prototype.toString) {
    return 'function toString() { [native code] }'
  }
  if (this === WebGLRenderingContext.prototype.getParameter) {
    return 'function getParameter() { [native code] }'
  }
  return originalToString.apply(this)
}

// 7. Mock permissions API
if (navigator.permissions) {
  const originalQuery = navigator.permissions.query
  // @ts-ignore
  navigator.permissions.query = (parameters) => {
    if (parameters && parameters.name === 'notifications') {
      return Promise.resolve({ state: 'prompt' })
    }
    // @ts-ignore
    return originalQuery.apply(navigator.permissions, [parameters])
  }
}
