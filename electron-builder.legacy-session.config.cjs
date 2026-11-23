const createChinaEditionConfig = require('./electron-builder.cn.config.cjs')

module.exports = async function createLegacySessionConfig(context) {
  const edition = process.env.CHERRY_LEGACY_SESSION_EDITION
  if (edition !== 'cn' && edition !== 'global') throw new Error('Set CHERRY_LEGACY_SESSION_EDITION to cn or global')
  const base = edition === 'cn' ? await createChinaEditionConfig(context) : { extends: './electron-builder.yml' }
  return {
    ...base,
    extraMetadata: { ...base.extraMetadata, cherryLegacySessionCompatibility: true }
  }
}
