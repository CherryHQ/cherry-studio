const { createHash } = require('node:crypto')
const { createReadStream } = require('node:fs')
const path = require('node:path')

const createChinaEditionConfig = require('./electron-builder.cn.config.cjs')

module.exports = async function createRegionBridgeConfig(context) {
  const edition = process.env.CHERRY_REGION_BRIDGE_EDITION
  if (edition !== 'cn' && edition !== 'global') throw new Error('Set CHERRY_REGION_BRIDGE_EDITION to cn or global')
  const base = edition === 'cn' ? await createChinaEditionConfig(context) : { extends: './electron-builder.yml' }
  const dist = process.env.CHERRY_MAC_BRIDGE_ELECTRON_DIST
  const macBridge = edition === 'cn' && process.platform === 'darwin'
  if (macBridge) {
    const digest = process.env.CHERRY_MAC_BRIDGE_ELECTRON_SHA256
    if (!dist || !/^[a-f0-9]{64}$/.test(digest ?? '')) {
      throw new Error('The CN macOS bridge requires a pinned Electron distribution ZIP')
    }
    if (
      process.env.APPLE_TEAM_ID !== '87242QY66T' ||
      !process.env.APPLE_ID ||
      !process.env.APPLE_APP_SPECIFIC_PASSWORD
    ) {
      throw new Error('The CN macOS bridge requires the legacy Apple Team and notarization credentials')
    }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(dist)) hash.update(chunk)
    if (hash.digest('hex') !== digest) throw new Error('The bridge Electron distribution failed checksum verification')
  }
  return {
    ...base,
    extraMetadata: { ...base.extraMetadata, cherryRegionBridge: true },
    ...(macBridge && {
      electronDist: path.resolve(dist),
      mac: {
        sign: 'scripts/packaging/mac-region-bridge-sign.js',
        extendInfo: { CherryDesktopRegionBridge: true, ElectronSquirrelPreventDowngrades: true }
      }
    })
  }
}
