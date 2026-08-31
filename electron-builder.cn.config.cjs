const { CHINA_EDITION, getReleaseChannel } = require('./scripts/release/edition')

module.exports = async function createChinaEditionConfig({ packageMetadata }) {
  const { version } = await packageMetadata.value

  return {
    extends: './electron-builder.yml',
    appId: 'com.cherryai.cherrystudio.cn',
    productName: 'Cherry Studio 中国版',
    extraMetadata: {
      cherryEdition: CHINA_EDITION
    },
    protocols: [
      {
        name: 'Cherry Studio 中国版',
        schemes: ['cherrystudio-cn']
      }
    ],
    win: {
      executableName: 'Cherry Studio CN'
    },
    nsis: {
      shortcutName: 'Cherry Studio 中国版',
      uninstallDisplayName: 'Cherry Studio 中国版'
    },
    linux: {
      executableName: 'CherryStudioCN',
      desktop: {
        entry: {
          Name: 'Cherry Studio 中国版',
          StartupWMClass: 'CherryStudioCN'
        }
      },
      mimeTypes: ['x-scheme-handler/cherrystudio-cn']
    },
    publish: {
      provider: 'generic',
      url: 'https://releases.cherry-ai.com',
      channel: getReleaseChannel(version, CHINA_EDITION)
    }
  }
}
