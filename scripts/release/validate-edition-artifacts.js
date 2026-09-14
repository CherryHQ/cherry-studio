const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('yaml')

const { getExpectedReleaseArtifacts } = require('./edition')

const PLATFORM_NAMES = {
  darwin: 'mac',
  linux: 'linux',
  win32: 'windows'
}

function validateEditionArtifacts({ distDirectory, edition, platform, productName, version }) {
  const expected = getExpectedReleaseArtifacts({ edition, platform, productName, version })

  for (const fileName of expected.files) {
    const filePath = path.join(distDirectory, fileName)
    if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing ${edition} release artifact: ${fileName}`)
    }
  }

  for (const manifest of expected.manifests) {
    const manifestPath = path.join(distDirectory, manifest.file)
    if (!fs.statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing ${edition} update manifest: ${manifest.file}`)
    }

    const updateInfo = parse(fs.readFileSync(manifestPath, 'utf8'))
    const urls = Array.isArray(updateInfo?.files) ? updateInfo.files.map((file) => file.url) : []
    for (const url of manifest.urls) {
      if (!urls.includes(url)) {
        throw new Error(`${manifest.file} does not reference ${url}`)
      }
    }
  }
}

function main() {
  const edition = process.argv[2]
  if (!edition) {
    throw new Error('Usage: node scripts/release/validate-edition-artifacts.js <global|cn>')
  }

  const platform = PLATFORM_NAMES[process.platform]
  if (!platform) {
    throw new Error(`Unsupported release platform: ${process.platform}`)
  }

  const packageMetadata = require('../../package.json')
  validateEditionArtifacts({
    distDirectory: path.resolve('dist'),
    edition,
    platform,
    productName: 'Cherry Studio',
    version: packageMetadata.version
  })
  console.log(`Validated ${edition} ${platform} release artifacts`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { validateEditionArtifacts }
