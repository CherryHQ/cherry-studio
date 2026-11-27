const { execFileSync } = require('node:child_process')

const { signMacApp } = require('./mac-sign')

const TEAM = '87242QY66T'
const CN_ID = 'com.cherryai.cherrystudio.cn'
const GLOBAL_ID = 'com.kangfenmao.CherryStudio'
const DEVELOPER_ID = `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${TEAM}"`
const LEGACY_REQUIREMENT = `identifier "${CN_ID}" and ${DEVELOPER_ID}`
const BRIDGE_REQUIREMENT = `(identifier "${CN_ID}" or identifier "${GLOBAL_ID}") and ${DEVELOPER_ID}`

exports.default = async function signRegionBridge(configuration) {
  const { app, optionsForFile } = configuration
  await signMacApp({
    ...configuration,
    optionsForFile(filePath) {
      const options = optionsForFile?.(filePath)
      return filePath === app ? { ...options, requirements: `=designated => ${BRIDGE_REQUIREMENT}` } : options
    }
  })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--test-requirement', `=${LEGACY_REQUIREMENT}`, app], {
    stdio: 'inherit'
  })
}
