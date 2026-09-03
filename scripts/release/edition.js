const semver = require('semver')

const CHINA_EDITION = 'cn'
const GLOBAL_EDITION = 'global'
const EDITIONS = [GLOBAL_EDITION, CHINA_EDITION]

function assertEdition(edition) {
  if (!EDITIONS.includes(edition)) {
    throw new Error(`Unsupported release edition: ${edition}`)
  }
}

function getReleaseChannel(version, edition) {
  assertEdition(edition)
  const prerelease = semver.prerelease(version)
  if (prerelease === null && !semver.valid(version)) {
    throw new Error(`Invalid release version: ${version}`)
  }

  const channel = prerelease === null ? 'latest' : String(prerelease[0])
  return edition === CHINA_EDITION ? `${channel}-cn` : channel
}

function getReleaseProductName(productName, edition) {
  assertEdition(edition)
  return edition === CHINA_EDITION ? 'Cherry Studio CN' : productName
}

function getExpectedReleaseArtifacts({ edition, platform, productName, version }) {
  assertEdition(edition)
  const artifactProductName = getReleaseProductName(productName, edition).replace(/ /g, '-')
  const channel = getReleaseChannel(version, edition)

  if (platform === 'windows') {
    const baseName = `${artifactProductName}-${version}-win`
    const x64Setup = `${baseName}-x64-setup.exe`
    const arm64Setup = `${baseName}-arm64-setup.exe`
    return {
      files: [x64Setup, arm64Setup, `${baseName}-x64-portable.exe`, `${baseName}-arm64-portable.exe`],
      manifests: [{ file: `${channel}.yml`, urls: [x64Setup, arm64Setup] }]
    }
  }

  if (platform === 'mac') {
    const baseName = `${artifactProductName}-${version}-mac`
    const x64Zip = `${baseName}-x64.zip`
    const arm64Zip = `${baseName}-arm64.zip`
    return {
      files: [
        x64Zip,
        `${x64Zip}.blockmap`,
        arm64Zip,
        `${arm64Zip}.blockmap`,
        `${baseName}-x64.dmg`,
        `${baseName}-arm64.dmg`
      ],
      manifests: [{ file: `${channel}-mac.yml`, urls: [x64Zip, arm64Zip] }]
    }
  }

  if (platform === 'linux') {
    const baseName = `${artifactProductName}-${version}-linux`
    const x64AppImage = `${baseName}-x64.AppImage`
    const arm64AppImage = `${baseName}-arm64.AppImage`
    return {
      files: [
        x64AppImage,
        `${baseName}-x64.deb`,
        `${baseName}-x64.rpm`,
        arm64AppImage,
        `${baseName}-arm64.deb`,
        `${baseName}-arm64.rpm`
      ],
      manifests: [
        { file: `${channel}-linux.yml`, urls: [x64AppImage] },
        { file: `${channel}-linux-arm64.yml`, urls: [arm64AppImage] }
      ]
    }
  }

  throw new Error(`Unsupported release platform: ${platform}`)
}

module.exports = {
  CHINA_EDITION,
  EDITIONS,
  GLOBAL_EDITION,
  getExpectedReleaseArtifacts,
  getReleaseChannel,
  getReleaseProductName
}
