require('dotenv').config()
const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const apiCredentials =
    process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER
      ? {
          appleApiKey: process.env.APPLE_API_KEY,
          appleApiKeyId: process.env.APPLE_API_KEY_ID,
          appleApiIssuer: process.env.APPLE_API_ISSUER
        }
      : null
  const appleIdCredentials =
    process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
      ? {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID
        }
      : null

  if (!apiCredentials && !appleIdCredentials) {
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`

  await notarize({
    appPath,
    appBundleId: context.packager.appInfo.macBundleIdentifier,
    ...(apiCredentials || appleIdCredentials)
  })

  console.log('  • Notarized app:', appPath)
}
