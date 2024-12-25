const { downloadNpmPackage } = require('./utils')

async function downloadNpm(platform) {
  if (!platform || platform === 'mac') {
    downloadNpmPackage(
      '@lancedb/lancedb-darwin-arm64',
      'https://registry.npmjs.org/@lancedb/lancedb-darwin-arm64/-/lancedb-darwin-arm64-0.14.0.tgz'
    )
    downloadNpmPackage(
      '@lancedb/lancedb-darwin-x64',
      'https://registry.npmjs.org/@lancedb/lancedb-darwin-x64/-/lancedb-darwin-x64-0.14.0.tgz'
    )
  }

  if (!platform || platform === 'linux') {
    downloadNpmPackage(
      '@lancedb/lancedb-linux-arm64-gnu',
      'https://registry.npmjs.org/@lancedb/lancedb-linux-arm64-gnu/-/lancedb-linux-arm64-gnu-0.14.0.tgz'
    )
    downloadNpmPackage(
      '@lancedb/lancedb-linux-x64-gnu',
      'https://registry.npmjs.org/@lancedb/lancedb-linux-x64-gnu/-/lancedb-linux-x64-gnu-0.14.0.tgz'
    )
  }
}

const platformArg = process.argv[2]
downloadNpm(platformArg)
