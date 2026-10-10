const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function isVelopackArtifact(file) {
  const name = path.basename(file)
  return (name.startsWith('releases.') && name.endsWith('.json')) || name.startsWith('CherryStudio-')
}

async function validateVelopackArtifacts(directory, edition, platform, version) {
  const os = { windows: 'win', mac: 'osx', linux: 'linux' }[platform]
  const names = fs.readdirSync(directory)
  const feeds = ['x64', 'arm64'].map((arch) => `releases.${os}-${arch}-${edition}.json`)
  if (!names.some(isVelopackArtifact)) return []
  const allowed = []
  for (const [index, feedName] of feeds.entries()) {
    const arch = ['x64', 'arm64'][index]
    const feed = JSON.parse(fs.readFileSync(path.join(directory, feedName), 'utf8'))
    if (!Array.isArray(feed.Assets) || feed.Assets.filter((asset) => asset.Type === 'Full').length !== 1)
      throw new Error('Invalid Velopack feed')
    allowed.push(feedName)
    for (const asset of feed.Assets) {
      if (
        asset.Version !== version ||
        asset.PackageId !== `CherryStudio-${edition}` ||
        !['Full', 'Delta'].includes(asset.Type) ||
        !/^[\w.+-]+\.nupkg$/.test(asset.FileName) ||
        !asset.FileName.includes(`${os}-${arch}-${edition}`)
      )
        throw new Error('Velopack package identity mismatch')
      const file = path.join(directory, asset.FileName)
      const hash = createHash('sha256')
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
      if (hash.digest('hex') !== asset.SHA256.toLowerCase() || fs.statSync(file).size !== asset.Size)
        throw new Error('Velopack package checksum mismatch')
      allowed.push(asset.FileName)
    }
    const extension = { win: 'exe', osx: 'zip', linux: 'AppImage' }[os]
    const installer = `CherryStudio-${edition}-${version}-${os}-${arch}-Velopack.${extension}`
    if (!fs.statSync(path.join(directory, installer)).isFile()) throw new Error('Missing Velopack installer')
    allowed.push(installer)
  }
  return allowed
}

module.exports = { isVelopackArtifact, validateVelopackArtifacts }
