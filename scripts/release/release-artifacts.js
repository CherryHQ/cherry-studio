const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('yaml')

const { EDITIONS, getExpectedReleaseArtifacts } = require('./edition')
const { validateEditionArtifacts } = require('./validate-edition-artifacts')

const PLATFORMS = { windows: 'windows-latest', mac: 'macos-latest', linux: 'ubuntu-latest' }

async function hashFile(file) {
  const hash = createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

function listFiles(directory, prefix = '') {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix + entry.name
      if (entry.isDirectory()) return listFiles(path.join(directory, entry.name), `${relative}/`)
      if (!entry.isFile()) throw new Error(`Unexpected archive entry: ${relative}`)
      return [relative]
    })
    .sort()
}

function linkDirectory(source, destination) {
  for (const file of listFiles(source)) {
    const target = path.join(destination, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.linkSync(path.join(source, file), target)
  }
}

async function validateFiles(directory, tag) {
  const files = []
  for (const edition of EDITIONS) {
    for (const platform of Object.keys(PLATFORMS)) {
      const relative = `${edition}/${platform}`
      const distDirectory = path.join(directory, relative)
      const options = { edition, platform, productName: 'Cherry Studio', version: tag.slice(1) }
      validateEditionArtifacts({ ...options, distDirectory })
      const expected = getExpectedReleaseArtifacts(options)
      const allowed = new Set([
        ...expected.files,
        ...expected.files.map((file) => `${file}.blockmap`),
        ...expected.manifests.map((manifest) => manifest.file)
      ])
      for (const file of listFiles(distDirectory)) {
        if (!allowed.has(file)) throw new Error(`Unexpected ${edition} ${platform} artifact: ${file}`)
        files.push(`${relative}/${file}`)
      }
      for (const manifest of expected.manifests) {
        const update = parse(fs.readFileSync(path.join(distDirectory, manifest.file), 'utf8'))
        const urls = update.files.map((file) => file.url)
        const referencedFiles = expected.files.filter(
          (file) =>
            !file.endsWith('.blockmap') &&
            (platform !== 'linux' || file.includes(manifest.file.includes('-arm64') ? '-arm64.' : '-x64.'))
        )
        if (
          urls.some((url) => !referencedFiles.includes(url)) ||
          (update.path && !referencedFiles.includes(update.path))
        ) {
          throw new Error(`Cross-edition or unexpected reference in ${manifest.file}`)
        }
        for (const file of update.files) {
          const actual = await hashFile(path.join(distDirectory, file.url))
          if (
            file.sha512 !== actual ||
            (file.size !== undefined && file.size !== fs.statSync(path.join(distDirectory, file.url)).size)
          ) {
            throw new Error(`Update manifest checksum mismatch: ${file.url}`)
          }
        }
        if (update.path && update.sha512 !== (await hashFile(path.join(distDirectory, update.path)))) {
          throw new Error(`Update manifest checksum mismatch: ${manifest.file}`)
        }
      }
    }
  }
  if (!tag.includes('-')) files.push('common/release-history.json')
  const actual = listFiles(directory).filter((file) => file !== 'metadata.json')
  if (JSON.stringify(actual) !== JSON.stringify(files.sort()))
    throw new Error('Archive contains missing or unexpected files')
  return files
}

function readMetadata(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8'))
}

async function assembleArchive({ selected, baseline, directory, repository, tag, sha, runId, platform, builderFile }) {
  if (!['all', ...Object.keys(PLATFORMS)].includes(platform)) throw new Error(`Invalid platform: ${platform}`)
  if (platform !== 'all') {
    const metadata = readMetadata(baseline)
    for (const [key, value] of Object.entries({ repository, tag, sha })) {
      if (metadata[key] !== value) throw new Error(`Baseline archive ${key} does not match the build`)
    }
    linkDirectory(baseline, directory)
  } else {
    fs.mkdirSync(directory, { recursive: true })
  }
  for (const edition of EDITIONS) {
    for (const [target, runner] of Object.entries(PLATFORMS)) {
      if (platform !== 'all' && platform !== target) continue
      const destination = path.join(directory, edition, target)
      fs.rmSync(destination, { recursive: true, force: true })
      linkDirectory(path.join(selected, `release-${tag}-${runner}-${edition}`), destination)
    }
  }
  if (!tag.includes('-') && ['all', 'linux'].includes(platform)) {
    fs.mkdirSync(path.join(directory, 'common'), { recursive: true })
    const history = path.join(directory, 'common/release-history.json')
    fs.rmSync(history, { force: true })
    fs.linkSync(path.join(selected, `release-${tag}-history`, 'release-history.json'), history)
  }
  const files = await validateFiles(directory, tag)
  const gitcodeBody = parse(fs.readFileSync(builderFile, 'utf8')).releaseInfo.releaseNotes
  const metadata = { repository, tag, sha, runId, gitcodeBody, files }
  fs.rmSync(path.join(directory, 'metadata.json'), { force: true })
  fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2))
  return metadata
}

function stageAssets(directory, destination, metadata, editions) {
  fs.mkdirSync(destination, { recursive: true })
  // Older retained archives store the file inventory as a checksum map.
  const files = Array.isArray(metadata.files) ? metadata.files : Object.keys(metadata.files)
  for (const file of files) {
    if (file.startsWith('common/') || editions.some((edition) => file.startsWith(`${edition}/`))) {
      fs.linkSync(path.join(directory, file), path.join(destination, path.basename(file)))
    }
  }
}

async function main() {
  const [command, directory, destination] = process.argv.slice(2)
  const { GH_REPO: repository, TAG: tag, RELEASE_SHA: sha, SOURCE_RUN_ID: runId } = process.env
  if (command === 'assemble') {
    const metadata = await assembleArchive({
      selected: 'selected-release-artifacts',
      baseline: 'baseline-release-artifacts',
      directory,
      repository,
      tag,
      sha,
      runId,
      platform: process.env.PLATFORM,
      builderFile: process.env.RELEASE_BUILDER_FILE || 'electron-builder.yml'
    })
    stageAssets(directory, destination, metadata, ['global'])
  } else if (command === 'sync') {
    const metadata = readMetadata(directory)
    stageAssets(directory, destination, metadata, EDITIONS)
    fs.writeFileSync('release_body.txt', metadata.gitcodeBody)
  } else throw new Error(`Unknown archive command: ${command}`)
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
module.exports = { assembleArchive, stageAssets }
