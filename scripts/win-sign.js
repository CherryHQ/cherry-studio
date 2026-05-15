const { execSync } = require('child_process')

const DEFAULT_TIMESTAMP_URLS = [
  'http://timestamp.digicert.com',
  'http://timestamp.sectigo.com',
  'http://timestamp.globalsign.com/tsa/r6advanced1',
  'http://timestamp.globalsign.com/tsa/r45standard'
]

const MAX_SIGN_ATTEMPTS_PER_TIMESTAMP = 3
const SIGN_RETRY_DELAYS_MS = [5000, 10000]

function getTimestampUrls() {
  const configuredUrls = process.env.WIN_SIGN_TIMESTAMP_URLS?.split(',')
    .map((url) => url.trim())
    .filter(Boolean)

  return configuredUrls?.length ? configuredUrls : DEFAULT_TIMESTAMP_URLS
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function signFile({ certPath, csp, keyContainer, path, timestampUrl }) {
  const signCommand = `signtool sign /tr "${timestampUrl}" /td sha256 /fd sha256 /v /f "${certPath}" /csp "${csp}" /k "${keyContainer}" "${path}"`
  execSync(signCommand, { stdio: 'inherit' })
}

function signFileWithRetry(options) {
  const timestampUrls = getTimestampUrls()
  let lastError

  for (const timestampUrl of timestampUrls) {
    for (let attempt = 1; attempt <= MAX_SIGN_ATTEMPTS_PER_TIMESTAMP; attempt++) {
      try {
        console.log(
          `Signing attempt ${attempt}/${MAX_SIGN_ATTEMPTS_PER_TIMESTAMP} with timestamp server: ${timestampUrl}`
        )
        signFile({ ...options, timestampUrl })
        return
      } catch (error) {
        lastError = error

        if (attempt < MAX_SIGN_ATTEMPTS_PER_TIMESTAMP) {
          const delayMs = SIGN_RETRY_DELAYS_MS[attempt - 1] ?? SIGN_RETRY_DELAYS_MS[SIGN_RETRY_DELAYS_MS.length - 1]
          console.warn(`Code signing attempt failed. Retrying in ${delayMs / 1000}s...`)
          sleep(delayMs)
        } else {
          console.warn(`Timestamp server failed after ${MAX_SIGN_ATTEMPTS_PER_TIMESTAMP} attempts: ${timestampUrl}`)
        }
      }
    }
  }

  throw lastError
}

exports.default = async function (configuration) {
  if (process.env.WIN_SIGN) {
    const { path } = configuration
    if (configuration.path) {
      try {
        const certPath = process.env.CHERRY_CERT_PATH
        const keyContainer = process.env.CHERRY_CERT_KEY
        const csp = process.env.CHERRY_CERT_CSP

        if (!certPath || !keyContainer || !csp) {
          throw new Error('CHERRY_CERT_PATH, CHERRY_CERT_KEY or CHERRY_CERT_CSP is not set')
        }

        console.log('Start code signing...')
        console.log('Signing file:', path)
        signFileWithRetry({ certPath, csp, keyContainer, path })
        console.log('Code signing completed')
      } catch (error) {
        console.error('Code signing failed:', error)
        throw error
      }
    }
  }
}
