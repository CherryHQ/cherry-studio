const fs = require('fs')
const path = require('path')

const clearBetterSqlite3ElectronMetadata = (appDir) => {
  const metadataPath = path.join(appDir, 'node_modules', 'better-sqlite3', 'build', 'Release', '.forge-meta')
  fs.rmSync(metadataPath, { force: true })
  return metadataPath
}
exports.clearBetterSqlite3ElectronMetadata = clearBetterSqlite3ElectronMetadata

exports.default = async function ({ appDir }) {
  clearBetterSqlite3ElectronMetadata(appDir)
  return true
}
