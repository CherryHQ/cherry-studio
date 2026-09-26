const fs = require('node:fs')
const path = require('node:path')
const { resolveReleaseProfile } = require('./release-profile.cjs')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'manifests')
const selectedManifest = process.env.RELEASE_MANIFEST_FILE
const entries = fs
  .readdirSync(directory)
  .filter((name) => (selectedManifest ? name === selectedManifest : /^installers-.*\.json$/.test(name)))
  .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name))))
const version = require('../package.json').version
const profile = resolveReleaseProfile()
const platforms = profile.supportedPlatforms
const selected = (process.env.RELEASE_PLATFORMS || platforms.join(',')).split(',')
const releaseSource = process.env.RELEASE_SOURCE_SHA || process.env.GITHUB_SHA
for (const target of selected) {
  if (!platforms.includes(target)) throw new Error(`Unknown release platform: ${target}`)
  const [platform, arch] = target.split('-')
  const entry = entries.find((value) => value.platform === platform && value.arch === arch)
  if (
    !entry ||
    entry.source !== releaseSource ||
    entry.version !== version ||
    entry.profile !== profile.id ||
    entry.features?.uar !== profile.uarEnabled ||
    entry.artifacts.length !== 1 ||
    entry.artifacts.some((artifact) => artifact.profile !== profile.id)
  )
    throw new Error(`Incomplete release: ${platform}/${arch}`)
}
const manifestFile = path.join(root, 'release-manifest.json')
const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile)) : null
const previousMatchesRelease =
  previous?.version === version &&
  previous.profile === profile.id &&
  previous.source === releaseSource &&
  previous.features?.uar === profile.uarEnabled
if (previous?.version === version && !previousMatchesRelease && selected.length !== platforms.length) {
  throw new Error('Existing release metadata does not match the frozen source and feature profile')
}
const retained = previousMatchesRelease
  ? previous.artifacts
      .filter((item) => !selected.includes(`${item.platform}-${item.arch}`))
      .map((item) => ({ ...item, source: item.source || previous.source }))
  : []
const artifactRows = [
  ...retained,
  ...entries
    .filter((entry) => selected.includes(`${entry.platform}-${entry.arch}`))
    .flatMap((entry) =>
      entry.artifacts.map((artifact) => ({
        ...artifact,
        platform: entry.platform,
        arch: entry.arch,
        profile: entry.profile,
        source: entry.source
      }))
    )
]
const pendingPlatforms = platforms.filter(
  (target) => !artifactRows.some((item) => `${item.platform}-${item.arch}` === target)
)
const manifest = {
  version,
  profile: profile.id,
  features: { uar: profile.uarEnabled },
  supportedPlatforms: [...platforms],
  source: releaseSource,
  publishedAt: new Date().toISOString(),
  pendingPlatforms,
  artifacts: artifactRows
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
const rows = artifactRows
  .map(
    (item) =>
      `| \`${item.name}\` | ${(item.size / 1048576).toFixed(1)} MB | [Download](${item.url}) | \`${item.sha256}\` | ${item.signing} | [\`${item.source.slice(0, 9)}\`](https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${item.source}) |`
  )
  .join('\n')
const release = `## v${version} — ${manifest.publishedAt}\n\nProfile: ${profile.id}\n\n| Installer | Size | Download | SHA-256 | Signing | Source |\n|---|---|---|---|---|---|\n${rows}\n\n`
const file = path.join(root, 'RELEASES.md')
const original = fs.readFileSync(file, 'utf8')
const marker = '<!-- releases:newest-first -->'
if (!original.includes(marker)) throw new Error('RELEASES.md insertion marker is missing')
const heading = `## v${version} — `
const start = original.indexOf(heading)
const end = start < 0 ? -1 : original.indexOf('\n## ', start + heading.length)
const updated =
  start < 0
    ? original.replace(marker, `${marker}\n\n${release}`)
    : original.slice(0, start) + release + (end < 0 ? '' : original.slice(end + 1))
fs.writeFileSync(file, updated)
