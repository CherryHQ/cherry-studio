const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'manifests')
const entries = fs.readdirSync(directory).filter((name) => /^installers-.*\.json$/.test(name)).map((name) => JSON.parse(fs.readFileSync(path.join(directory, name))))
const version = require('../package.json').version
for (const platform of ['win32', 'darwin', 'linux']) for (const arch of ['x64', 'arm64']) {
  const entry = entries.find((value) => value.platform === platform && value.arch === arch)
  if (!entry || entry.source !== process.env.GITHUB_SHA || entry.version !== version || entry.artifacts.length !== (platform === 'linux' ? 3 : 1)) throw new Error(`Incomplete release: ${platform}/${arch}`)
}
const artifactRows = entries.flatMap((entry) => entry.artifacts.map((artifact) => ({ ...artifact, platform: entry.platform, arch: entry.arch })))
const manifest = { version, source: process.env.GITHUB_SHA, publishedAt: new Date().toISOString(), artifacts: artifactRows }
fs.writeFileSync(path.join(root, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const rows = artifactRows.map((item) => `| \`${item.name}\` | ${(item.size / 1048576).toFixed(1)} MB | [Download](${item.url}) | \`${item.sha256}\` | ${item.signing} |`).join('\n')
const release = `## v${version} — ${manifest.publishedAt}\n\nCommit [\`${manifest.source.slice(0,9)}\`](https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${manifest.source})\n\n| Installer | Size | Download | SHA-256 | Signing |\n|---|---|---|---|---|\n${rows}\n\n`
const file = path.join(root, 'RELEASES.md')
const original = fs.readFileSync(file, 'utf8')
const marker = '<!-- releases:newest-first -->'
if (!original.includes(marker)) throw new Error('RELEASES.md insertion marker is missing')
fs.writeFileSync(file, original.replace(marker, `${marker}\n\n${release}`))
