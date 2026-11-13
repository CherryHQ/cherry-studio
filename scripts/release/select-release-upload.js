const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('yaml')

const { getExpectedReleaseArtifacts } = require('./edition')
const { validateEditionArtifacts } = require('./validate-edition-artifacts')

async function main() {
  const [edition, platform] = process.argv.slice(2)
  const { TAG: tag } = process.env
  const distDirectory = 'dist'
  const options = { edition, platform, productName: 'Cherry Studio', version: tag.slice(1), distDirectory }
  validateEditionArtifacts(options)
  const expected = getExpectedReleaseArtifacts(options)
  const files = [
    ...new Set([
      ...expected.files,
      ...expected.manifests.map((manifest) => manifest.file),
      ...expected.files
        .map((file) => file + '.blockmap')
        .filter((file) => fs.existsSync(path.join(distDirectory, file)))
    ])
  ]
  for (const { file } of expected.manifests) {
    const update = parse(fs.readFileSync(path.join(distDirectory, file), 'utf8'))
    const architecture = file.endsWith('-arm64.yml') ? 'arm64' : 'x64'
    const urls = expected.files.filter(
      (name) => !name.endsWith('.blockmap') && (platform !== 'linux' || name.includes(`-${architecture}.`))
    )
    if (update.files.some((entry) => !urls.includes(entry.url)) || (update.path && !urls.includes(update.path))) {
      throw new Error(`Unexpected update reference in ${file}`)
    }
    const hashes = new Map()
    for (const entry of update.files) {
      const source = path.join(distDirectory, entry.url)
      const hash = createHash('sha512')
      for await (const chunk of fs.createReadStream(source)) hash.update(chunk)
      const digest = hash.digest('base64')
      hashes.set(entry.url, digest)
      if (entry.sha512 !== digest || (entry.size !== undefined && entry.size !== fs.statSync(source).size)) {
        throw new Error(`Update manifest checksum mismatch: ${entry.url}`)
      }
    }
    if (update.path && update.sha512 !== hashes.get(update.path)) {
      throw new Error(`Update manifest checksum mismatch: ${file}`)
    }
  }
  const sources = Object.fromEntries(
    files.map((file) => [`${edition}/${platform}/${file}`, path.join(distDirectory, file)])
  )
  if (edition === 'global' && platform === 'linux' && !tag.includes('-')) {
    sources['common/release-history.json'] = 'resources/cherry-studio/release-history.json'
  }
  fs.writeFileSync('release-upload.json', JSON.stringify(sources))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
