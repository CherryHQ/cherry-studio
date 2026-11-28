const MAC12_ELECTRON_VERSION = '43.8.13'

module.exports = {
  extends: './electron-builder.yml',
  electronVersion: MAC12_ELECTRON_VERSION,
  npmRebuild: false,
  mac: {
    minimumSystemVersion: '12.0.0',
    artifactName: '${productName}-${version}-${arch}-mac12.${ext}'
  }
}
