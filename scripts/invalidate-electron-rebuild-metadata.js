const fs = require('node:fs')
const path = require('node:path')

function invalidateElectronRebuildMetadata(moduleDirectory) {
  // pnpm rebuild replaces the binary without invalidating @electron/rebuild's ABI marker.
  fs.rmSync(path.join(moduleDirectory, 'build', 'Release', '.forge-meta'), { force: true })
}

exports.invalidateElectronRebuildMetadata = invalidateElectronRebuildMetadata

if (require.main === module) {
  const moduleDirectory = path.dirname(require.resolve('better-sqlite3/package.json'))
  invalidateElectronRebuildMetadata(moduleDirectory)
}
