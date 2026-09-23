const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'build/integration-output')
const pins = JSON.parse(fs.readFileSync(path.join(root, 'build/integration-sources.json')))
const tag = process.env.PAYLOAD_TAG
if (!/^boss-tools-[a-zA-Z0-9.-]+$/.test(tag || '')) throw new Error('A unique boss-tools-* release tag is required')
const repository = process.env.GITHUB_REPOSITORY
const url = (asset) => `https://github.com/${repository}/releases/download/${tag}/${asset}`
const tools = new Map()
for (const filename of fs.readdirSync(directory).filter((file) => /^tools-.*\.json$/.test(file))) {
  for (const { name, version, platform, asset, ...record } of JSON.parse(fs.readFileSync(path.join(directory, filename)))) {
    if (!tools.has(name)) tools.set(name, { name, version, packages: {} })
    tools.get(name).packages[platform] = { ...record, url: url(asset) }
  }
}
for (const name of Object.keys(pins.tools)) {
  for (const platform of ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']) {
    if (!tools.get(name)?.packages[platform]) throw new Error(`Missing native binary: ${name} ${platform}`)
  }
}
tools.set('node', JSON.parse(fs.readFileSync(path.join(root, 'build/node-artifacts.json'))))
const images = { surrealdb: 'surrealdb/surrealdb:v3.2.4@sha256:51baed8709f57f67dcf04b30e3177db846803fa9342dae2be58c6fa5f8d59843' }
for (const service of ['surreal-memory', 'liter-llm']) {
  const record = JSON.parse(fs.readFileSync(path.join(directory, `${service}-image.json`)))
  if (!/^sha256:[a-f0-9]{64}$/.test(record.digest)) throw new Error(`Missing image digest: ${service}`)
  images[service] = `${record.image}@${record.digest}`
}
const skills = JSON.parse(fs.readFileSync(path.join(directory, 'compass-skills.json')))
const manifest = { schema: 1, sources: pins.sources, tools: [...tools.values()], images, compassSkills: { url: url(skills.asset), sha256: skills.sha256 } }
fs.writeFileSync(path.join(directory, 'integration-artifacts.json'), JSON.stringify(manifest, null, 2) + '\n')
const assets = fs.readdirSync(directory).filter((name) => !name.endsWith('-image.json') && !name.startsWith('tools-') && name !== 'compass-skills.json').map((name) => path.join(directory, name))
execFileSync('gh', ['release', 'create', tag, ...assets, '--target', process.env.GITHUB_SHA, '--title', `The Boss native integration payload ${tag}`, '--notes', 'Pinned native executables, Compass skills, service image digests, and checksums for installer packaging. Installed Windows acceptance remains pending.'], { stdio: 'inherit' })
