const CHINA_EDITION = 'cn'
const GLOBAL_EDITION = 'global'
const EDITIONS = [GLOBAL_EDITION, CHINA_EDITION]
const RELEASE_ARCHITECTURES = ['x64', 'arm64']

function assertEdition(edition) {
  if (!EDITIONS.includes(edition)) {
    throw new Error(`Unsupported release edition: ${edition}`)
  }
}

function getReleaseChannel(version, edition) {
  assertEdition(edition)
  const semver = require('semver')
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

function getReleaseDownloadGroups({ edition, platform, productName, version }) {
  assertEdition(edition)
  const artifactProductName = getReleaseProductName(productName, edition).replace(/ /g, '-')
  const platformName = platform === 'windows' ? 'win' : platform

  if (!['windows', 'mac', 'linux'].includes(platform)) {
    throw new Error(`Unsupported release platform: ${platform}`)
  }

  return RELEASE_ARCHITECTURES.map((architecture) => {
    const baseName = `${artifactProductName}-${version}-${platformName}-${architecture}`
    let artifacts

    if (platform === 'windows') {
      artifacts = [
        { fileName: `${baseName}-setup.exe`, label: 'Installer' },
        { fileName: `${baseName}-portable.exe`, label: 'Portable' }
      ]
    } else if (platform === 'mac') {
      artifacts = [
        { fileName: `${baseName}.dmg`, label: 'DMG' },
        { fileName: `${baseName}.zip`, label: 'ZIP' }
      ]
    } else {
      artifacts = [
        { fileName: `${baseName}.AppImage`, label: 'AppImage' },
        { fileName: `${baseName}.deb`, label: 'DEB' },
        { fileName: `${baseName}.rpm`, label: 'RPM' }
      ]
    }

    return { architecture, artifacts }
  })
}

function getExpectedReleaseArtifacts({ edition, platform, productName, version }) {
  const downloadGroups = getReleaseDownloadGroups({ edition, platform, productName, version })
  const channel = getReleaseChannel(version, edition)
  const fileName = (architecture, label) =>
    downloadGroups
      .find((group) => group.architecture === architecture)
      .artifacts.find((artifact) => artifact.label === label).fileName

  if (platform === 'windows') {
    const x64Setup = fileName('x64', 'Installer')
    const arm64Setup = fileName('arm64', 'Installer')
    return {
      files: [x64Setup, arm64Setup, fileName('x64', 'Portable'), fileName('arm64', 'Portable')],
      manifests: [{ file: `${channel}.yml`, urls: [x64Setup, arm64Setup] }]
    }
  }

  if (platform === 'mac') {
    const x64Zip = fileName('x64', 'ZIP')
    const arm64Zip = fileName('arm64', 'ZIP')
    return {
      files: [
        x64Zip,
        `${x64Zip}.blockmap`,
        arm64Zip,
        `${arm64Zip}.blockmap`,
        fileName('x64', 'DMG'),
        fileName('arm64', 'DMG')
      ],
      manifests: [{ file: `${channel}-mac.yml`, urls: [x64Zip, arm64Zip] }]
    }
  }

  if (platform === 'linux') {
    const x64AppImage = fileName('x64', 'AppImage')
    const arm64AppImage = fileName('arm64', 'AppImage')
    return {
      files: [
        x64AppImage,
        fileName('x64', 'DEB'),
        fileName('x64', 'RPM'),
        arm64AppImage,
        fileName('arm64', 'DEB'),
        fileName('arm64', 'RPM')
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
  getReleaseDownloadGroups,
  getReleaseChannel,
  getReleaseProductName
}
