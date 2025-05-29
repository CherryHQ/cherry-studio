const { execSync } = require('child_process')

exports.default = async function (configuration) {
  if (process.env.WIN_SIGN) {
    const { path } = configuration
    if (configuration.path) {
      try {
        console.log('Start code signing...')
        console.log('Signing file:', path)
        const signCommand = `signtool sign /tr http://timestamp.comodoca.com /td sha256 /fd sha256 /a /v "${path}"`
        execSync(signCommand, { stdio: 'inherit' })
        console.log('Code signing completed')
      } catch (error) {
        console.error('Code signing failed:', error)
        throw error
      }
    }
  }
}
