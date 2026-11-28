const WIN7_ELECTRON_VERSION = '44.11.6'
const WIN7_ELECTRON_MIRROR =
  process.env.CHERRY_WIN7_ELECTRON_MIRROR || 'https://github.com/Alex313031/electron-legacy/releases/download/'

module.exports = {
  extends: './electron-builder.yml',
  electronVersion: WIN7_ELECTRON_VERSION,
  npmRebuild: false,
  electronDownload: {
    mirror: WIN7_ELECTRON_MIRROR,
    customDir: `v${WIN7_ELECTRON_VERSION}`
  },
  win: {
    artifactName: '${productName}-${version}-${arch}-win7-setup.${ext}'
  },
  nsis: {
    artifactName: '${productName}-${version}-${arch}-win7-setup.${ext}',
    include: 'build/nsis-installer-win7.nsh'
  },
  portable: {
    artifactName: '${productName}-${version}-${arch}-win7-portable.${ext}'
  }
}
