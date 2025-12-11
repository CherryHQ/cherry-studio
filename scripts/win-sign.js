const { execSync } = require('child_process')

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
        const signCommand = `signtool sign /tr http://timestamp.comodoca.com /td sha256 /fd sha256 /v /f "${certPath}" /csp "${csp}" /k "${keyContainer}" "${path}"`
        execSync(signCommand, { stdio: 'inherit' })
        console.log('Code signing completed')
      } catch (error) {
        console.error('Code signing failed:', error)
        throw error
      }
    }
  }
}
