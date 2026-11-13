const fs = require('node:fs')
const { parse, stringify } = require('yaml')
const { z } = require('zod')

const { getExpectedReleaseArtifacts } = require('./edition')

const manifestSchema = z.looseObject({
  version: z.string(),
  releaseDate: z.string().optional(),
  files: z.array(z.looseObject({ url: z.string(), sha512: z.string().min(1), size: z.number().positive() }))
})

function mergeMacManifests({ edition, version, manifests }) {
  const expected = getExpectedReleaseArtifacts({ edition, platform: 'mac', productName: 'Cherry Studio', version })
  const [target] = expected.manifests
  const allowed = new Set(expected.files.filter((file) => !file.endsWith('.blockmap')))
  const files = new Map()
  let metadata
  for (const content of manifests) {
    const manifest = manifestSchema.parse(parse(content))
    if (manifest.version !== version) throw new Error('macOS update manifest version mismatch')
    metadata ??= manifest
    for (const file of manifest.files) {
      if (!allowed.has(file.url) || files.has(file.url)) throw new Error(`Unexpected macOS update entry: ${file.url}`)
      files.set(file.url, file)
    }
  }
  if (target.urls.some((url) => !files.has(url))) throw new Error('Incomplete macOS update manifests')
  const ordered = [...target.urls, ...[...files.keys()].filter((url) => !target.urls.includes(url)).sort()].map((url) =>
    files.get(url)
  )
  return {
    file: target.file,
    contents: stringify({ ...metadata, version, files: ordered, path: ordered[0].url, sha512: ordered[0].sha512 })
  }
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(mergeMacManifests(JSON.parse(fs.readFileSync(0, 'utf8')))))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

module.exports = { mergeMacManifests }
