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

/** Prune until the frozen validator accepts, or `null` when a break is not droppable. */
function downconvert(validateCatalogFile, file, document) {
  let dropped = 0
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
  const published = []

  for (const version of listSchemaVersions(compatDirectory, currentVersion)) {
    const { validateCatalogFile } = await import(
      pathToFileURL(path.join(compatDirectory, `v${version}-validator.mjs`)).href
    )

    const contents = {}
    for (const file of CATALOG_FILES) {
      const original = fs.readFileSync(path.join(sourceDirectory, file))
      if (version === currentVersion) {
        contents[file] = original
        continue
      }
      const result = downconvert(validateCatalogFile, file, JSON.parse(original))
      if (!result) {
        console.error(`v${version}: ${file} has a break that cannot be dropped, leaving the dir untouched`)
        break
      }
      // Re-serialize only what actually changed, so an untouched file stays byte-identical.
      contents[file] = result.dropped === 0 ? original : Buffer.from(`${JSON.stringify(result.document, null, 2)}\n`)
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
