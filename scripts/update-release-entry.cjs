const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'manifests')
const entries = fs
  .readdirSync(directory)
  .filter((name) => /^installers-.*\.json$/.test(name))
  .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name))))
const version = require('../package.json').version
const platforms = ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']
const selected = (process.env.RELEASE_PLATFORMS || platforms.join(',')).split(',')
const reused = new Set((process.env.REUSED_PLATFORMS || '').split(',').filter(Boolean))
for (const target of selected) {
  if (!platforms.includes(target)) throw new Error(`Unknown release platform: ${target}`)
  const [platform, arch] = target.split('-')
  const entry = entries.find((value) => value.platform === platform && value.arch === arch)
  const expectedSource = reused.has(target)
    ? /^[0-9a-f]{40}$/i.test(entry?.source || '')
    : entry?.source === process.env.GITHUB_SHA
  if (
    !entry ||
    !expectedSource ||
    entry.version !== version ||
    entry.artifacts.length !== (platform === 'linux' ? 3 : 1)
  )
    throw new Error(`Incomplete release: ${platform}/${arch}`)
}
const manifestFile = path.join(root, 'release-manifest.json')
const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile)) : null
const retained =
  previous?.version === version
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
        source: entry.source
      }))
    )
]
const pendingPlatforms = platforms.filter(
  (target) => !artifactRows.some((item) => `${item.platform}-${item.arch}` === target)
)
const manifest = {
  version,
  source: process.env.GITHUB_SHA,
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
const pending = pendingPlatforms.length ? `Pending platforms: ${pendingPlatforms.join(', ')}\n\n` : ''
const release = `## v${version} — ${manifest.publishedAt}\n\n${pending}| Installer | Size | Download | SHA-256 | Signing | Source |\n|---|---|---|---|---|---|\n${rows}\n\n`
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
