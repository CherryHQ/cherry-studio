const { signAsync } = require('@electron/osx-sign')
const path = require('node:path')

const helperEntitlements = path.resolve(__dirname, '..', 'build', 'entitlements.system-speech.plist')

function createOptionsForFile(appPath, originalOptionsForFile) {
  const helperPath = path.join(appPath, 'Contents', 'Resources', 'system-speech', 'cherry-system-speech')

  return (filePath) => {
    const options = originalOptionsForFile?.(filePath)
    if (filePath !== helperPath) return options

    return { ...options, entitlements: helperEntitlements }
  }
}

async function signMacApp(configuration, signer = signAsync) {
  await signer({
    ...configuration,
    optionsForFile: createOptionsForFile(configuration.app, configuration.optionsForFile)
  })
}

exports.createOptionsForFile = createOptionsForFile
exports.signMacApp = signMacApp
exports.default = async function (configuration) {
  await signMacApp(configuration)
}
