const { downloadNpmPackage } = require('./utils')

async function downloadNpm(platform) {
  if (!platform || platform === 'mac') {
    downloadNpmPackage(
      '@libsql/darwin-arm64',
      'https://registry.npmjs.org/@libsql/darwin-arm64/-/darwin-arm64-0.4.7.tgz'
    )
    downloadNpmPackage('@libsql/darwin-x64', 'https://registry.npmjs.org/@libsql/darwin-x64/-/darwin-x64-0.4.7.tgz')
  }

  if (!platform || platform === 'linux') {
    downloadNpmPackage(
      '@libsql/linux-arm64-gnu',
      'https://registry.npmjs.org/@libsql/linux-arm64-gnu/-/linux-arm64-gnu-0.4.7.tgz'
    )
    downloadNpmPackage(
      '@libsql/linux-arm64-musl',
      'https://registry.npmjs.org/@libsql/linux-arm64-musl/-/linux-arm64-musl-0.4.7.tgz'
    )
    downloadNpmPackage(
      '@libsql/linux-x64-gnu',
      'https://registry.npmjs.org/@libsql/linux-x64-gnu/-/linux-x64-gnu-0.4.7.tgz'
    )
    downloadNpmPackage(
      '@libsql/linux-x64-musl',
      'https://registry.npmjs.org/@libsql/linux-x64-musl/-/linux-x64-musl-0.4.7.tgz'
    )
  }
}

const platformArg = process.argv[2]
downloadNpm(platformArg)