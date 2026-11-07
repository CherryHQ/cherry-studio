/**
 * Stage the catalog into every published schema-version dir of the
 * `x-files/provider-registry` branch, one manifest each.
 *
 * The current version gets the catalog verbatim. An older version gets it
 * down-converted: its own frozen `compat/vN-validator.mjs` is the oracle, and
 * whatever it cannot represent is dropped — the same degradation a v2+ client
 * applies at read time (`schemas/forwardCompat.ts`), moved to publish time for
 * clients too old to do it themselves. A version whose break cannot be dropped
 * (a renamed or retyped field) stops receiving updates instead of failing the run.
 */
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const CATALOG_FILES = ['models.json', 'providers.json', 'provider-models.json']

// Frozen v1-v3 share this closed vocabulary; newer application/SDK keys do not belong here.
const V1_V3_IMAGE_PARAM_KEYS = new Set([
  'addWatermark',
  'aspectRatio',
  'background',
  'bottomScale',
  'cfg',
  'customSize',
  'detail',
  'enableInterleave',
  'function',
  'guidanceScale',
  'imageResolution',
  'imageWeight',
  'isSketch',
  'leftScale',
  'magicPromptOption',
  'maxImages',
  'moderation',
  'negativePrompt',
  'numImages',
  'numInferenceSteps',
  'outputCompression',
  'outputFormat',
  'personGeneration',
  'promptEnhancement',
  'promptExtend',
  'quality',
  'refMode',
  'refStrength',
  'renderingSpeed',
  'resemblance',
  'resolution',
  'rightScale',
  'safetyTolerance',
  'seed',
  'sequentialImageGeneration',
  'size',
  'sourceLang',
  'strength',
  'style',
  'styleType',
  'targetLang',
  'thinkingMode',
  'topScale',
  'upscaleFactor'
])

// Historical OpenAI image calls consume four native bindings and four mapped vendor fields.
const V1_V3_OPENAI_IMAGE_PARAM_KEYS = new Set([
  'numImages',
  'size',
  'seed',
  'aspectRatio',
  'quality',
  'background',
  'moderation',
  'style'
])
const V1_V3_OPENAI_IMAGE_ADAPTERS = new Set(['openai', 'azure', 'huggingface'])
const OPENAI_IMAGE_ENDPOINTS = new Set(['openai-image-generation', 'openai-image-edit'])

function usesLegacyOpenAIImageWire(file, entry, catalog) {
  const endpoint = (entry?.endpointTypes ?? catalog.models.get(entry?.modelId)?.endpointTypes)?.[0]
  if (!OPENAI_IMAGE_ENDPOINTS.has(endpoint)) return false
  if (file === 'models.json') return true
  const adapter = catalog.providers.get(entry.providerId)?.endpointConfigs?.[endpoint]?.adapterFamily
  return V1_V3_OPENAI_IMAGE_ADAPTERS.has(adapter)
}

/** Published schema versions, oldest first: every frozen baseline up to the current one. */
function listSchemaVersions(compatDirectory, currentVersion) {
  return fs
    .readdirSync(compatDirectory)
    .map((entry) => /^v(\d+)-validator\.mjs$/.exec(entry))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter((version) => version <= currentVersion)
    .sort((a, b) => a - b)
}

// Descending path order: an index is spliced only after every deeper or later
// sibling issue, so no not-yet-applied path shifts underneath us.
function comparePathsDescending(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] === b[index]) continue
    return a[index] < b[index] ? 1 : -1
  }
  return b.length - a.length
}

function dropIssuePaths(document, issuePaths) {
  let dropped = 0
  for (const issuePath of issuePaths) {
    let container = document
    for (const key of issuePath.slice(0, -1)) container = container?.[key]
    const last = issuePath[issuePath.length - 1]
    if (!Array.isArray(container) || typeof last !== 'number') continue
    container.splice(last, 1)
    dropped += 1
  }
  return dropped
}

function projectLegacyImageParams(schemaVersion, file, document, catalog) {
  if (schemaVersion > 3 || file === 'providers.json') return 0
  const entries = file === 'models.json' ? document?.models : document?.overrides
  if (!Array.isArray(entries)) return 0
  let dropped = 0
  for (const entry of entries) {
    const openai = usesLegacyOpenAIImageWire(file, entry, catalog)
    for (const mode of Object.values(entry?.imageGeneration?.modes ?? {})) {
      const supports = mode?.supports
      if (!supports || typeof supports !== 'object' || Array.isArray(supports)) continue
      for (const key of Object.keys(supports)) {
        if (V1_V3_IMAGE_PARAM_KEYS.has(key) && (!openai || V1_V3_OPENAI_IMAGE_PARAM_KEYS.has(key))) continue
        delete supports[key]
        dropped += 1
      }
      // Legacy image controls cannot execute animated output; retain their static choices.
      const format = supports.outputFormat
      if (format?.type === 'enum' && Array.isArray(format.options) && format.options.includes('gif')) {
        format.options = format.options.filter((option) => option !== 'gif')
        if (format.options.length === 0) delete supports.outputFormat
        else if (format.default === 'gif') delete format.default
        dropped += 1
      }
    }
  }
  return dropped
}

/** Prune until the frozen validator accepts, or `null` when a break is not droppable. */
function downconvert(validateCatalogFile, file, document, schemaVersion, catalog) {
  let dropped = projectLegacyImageParams(schemaVersion, file, document, catalog)
  for (;;) {
    try {
      validateCatalogFile(file, document)
      return { document, dropped }
    } catch (error) {
      const issues = error && typeof error === 'object' ? error.issues : null
      if (!Array.isArray(issues) || issues.length === 0) return null
      const pruned = dropIssuePaths(document, issues.map((issue) => issue.path).sort(comparePathsDescending))
      if (pruned === 0) return null
      dropped += pruned
    }
  }
}

function readPublishedMinAppVersion(manifestPath) {
  try {
    const minAppVersion = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).minAppVersion
    return typeof minAppVersion === 'string' && minAppVersion ? minAppVersion : null
  } catch {
    return null
  }
}

async function publishRegistryCatalog({
  sourceDirectory,
  compatDirectory,
  destinationDirectory,
  currentVersion,
  minAppVersion,
  sourceAppVersion,
  revision
}) {
  const { stampAndSerialize } = await import('../packages/provider-registry/scripts/catalogSerialization.mjs')
  const published = []
  const originals = Object.fromEntries(
    CATALOG_FILES.map((file) => [file, fs.readFileSync(path.join(sourceDirectory, file))])
  )
  const models = JSON.parse(originals['models.json']).models
  const providers = JSON.parse(originals['providers.json']).providers
  const catalog = {
    models: new Map((Array.isArray(models) ? models : []).map((model) => [model?.id, model])),
    providers: new Map((Array.isArray(providers) ? providers : []).map((provider) => [provider?.id, provider]))
  }

  for (const version of listSchemaVersions(compatDirectory, currentVersion)) {
    const { validateCatalogFile } = await import(
      pathToFileURL(path.join(compatDirectory, `v${version}-validator.mjs`)).href
    )

    const contents = {}
    for (const file of CATALOG_FILES) {
      const original = originals[file]
      if (version === currentVersion) {
        contents[file] = original
        continue
      }
      const result = downconvert(validateCatalogFile, file, JSON.parse(original), version, catalog)
      if (!result) {
        console.error(`v${version}: ${file} has a break that cannot be dropped, leaving the dir untouched`)
        break
      }
      // Re-serialize only what actually changed, so an untouched file stays byte-identical.
      if (result.dropped === 0) {
        contents[file] = original
      } else {
        delete result.document.version
        contents[file] = Buffer.from(stampAndSerialize(result.document))
      }
    }
    if (Object.keys(contents).length !== CATALOG_FILES.length) continue

    const destination = path.join(destinationDirectory, `v${version}`)
    const manifestPath = path.join(destination, 'manifest.json')
    // An older dir keeps the semantic floor it was published with; only the
    // current version tracks REGISTRY_MIN_APP_VERSION.
    const floor = (version === currentVersion ? null : readPublishedMinAppVersion(manifestPath)) ?? minAppVersion
    const manifest = {
      minAppVersion: floor,
      sourceAppVersion,
      revision,
      schemaVersion: version,
      files: Object.fromEntries(CATALOG_FILES.map((file) => [file, JSON.parse(contents[file]).version]))
    }

    fs.mkdirSync(destination, { recursive: true })
    for (const file of CATALOG_FILES) fs.writeFileSync(path.join(destination, file), contents[file])
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    published.push(`v${version}`)
  }

  return published
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main() {
  const published = await publishRegistryCatalog({
    sourceDirectory: requiredEnvironment('REGISTRY_PUBLISH_SOURCE'),
    compatDirectory: requiredEnvironment('REGISTRY_PUBLISH_COMPAT'),
    destinationDirectory: requiredEnvironment('REGISTRY_PUBLISH_DEST'),
    currentVersion: Number(requiredEnvironment('REGISTRY_PUBLISH_CURRENT_VERSION')),
    minAppVersion: requiredEnvironment('REGISTRY_PUBLISH_MIN_APP_VERSION'),
    sourceAppVersion: requiredEnvironment('REGISTRY_PUBLISH_SOURCE_APP_VERSION'),
    revision: Number(requiredEnvironment('REGISTRY_PUBLISH_REVISION'))
  })

  console.log(published.join(' '))
}

if (require.main === module) void main()

exports.publishRegistryCatalog = publishRegistryCatalog
