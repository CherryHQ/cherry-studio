const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const pins = JSON.parse(fs.readFileSync(path.join(root, 'build/integration-sources.json')))
const target = process.argv[2]
const platform = `${process.platform}-${process.arch}`
const workspace = path.join(root, 'build/integration-source')
const output = path.join(root, 'build/integration-output')
const run = (command, args, cwd, env = {}) => execFileSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function checkout(name) {
  const pin = pins.sources[name]
  const directory = path.join(workspace, name)
  fs.mkdirSync(directory, { recursive: true })
  run('git', ['init'], directory)
  run('git', ['fetch', '--depth=1', `https://github.com/${pin.repository}.git`, pin.revision], directory)
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], directory)
  return directory
}

async function parserSources() {
  const directory = path.join(workspace, 'parsers')
  fs.mkdirSync(directory, { recursive: true })
  const compressed = path.join(directory, 'sources.tar.zst')
  const response = await fetch(pins.parser.url)
  if (!response.ok) throw new Error(`Parser download: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(compressed))
  if (hash(compressed) !== pins.parser.sha256) throw new Error('Parser archive checksum mismatch')
  const archive = path.join(directory, 'sources.tar')
  await pipeline(fs.createReadStream(compressed), zlib.createZstdDecompress(), fs.createWriteStream(archive))
  run('tar', ['xf', archive, '-C', directory], root)
  const locate = (dir) => {
    if (fs.existsSync(path.join(dir, 'sources/language_definitions.json'))) return dir
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { const found = locate(path.join(dir, entry.name)); if (found) return found }
    }
  }
  const found = locate(directory)
  if (!found) throw new Error('Pinned parser archive has no language definitions')
  return found
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const records = []
  for (const [name, recipe] of Object.entries(pins.tools)) {
    const source = checkout(recipe.source)
    const cwd = path.join(source, recipe.directory || '')
    const env = name === 'compass' ? { TSLP_PARSER_SOURCE_DIR: await parserSources(), TSLP_OFFLINE: '1' } : {}
    run('cargo', ['build', '--release', '--locked', '-p', recipe.package, '--bin', name, '--target', target, ...(recipe.features ? ['--features', recipe.features] : [])], cwd, env)
    const binary = name + (process.platform === 'win32' ? '.exe' : '')
    const asset = `${name}-${platform}${process.platform === 'win32' ? '.exe' : ''}`
    fs.copyFileSync(path.join(cwd, 'target', target, 'release', binary), path.join(output, asset))
    records.push({ name, version: recipe.version, platform, asset, sha256: hash(path.join(output, asset)), binaries: [binary], archive: 'none' })
    if (name === 'compass' && platform === 'linux-x64') {
      const skills = path.join(output, 'compass-skills')
      fs.mkdirSync(skills, { recursive: true })
      fs.cpSync(path.join(source, 'crates/compass-cli/assets/compass-skill'), path.join(skills, 'compass'), { recursive: true })
      fs.cpSync(path.join(source, 'crates/compass-cli/assets/compass-focused-skills'), skills, { recursive: true })
      run('tar', ['czf', path.join(output, 'compass-skills.tar.gz'), '-C', output, 'compass-skills'], root)
      fs.writeFileSync(path.join(output, 'compass-skills.json'), JSON.stringify({ asset: 'compass-skills.tar.gz', sha256: hash(path.join(output, 'compass-skills.tar.gz')) }))
      fs.rmSync(skills, { recursive: true })
    }
  }
  fs.writeFileSync(path.join(output, `tools-${platform}.json`), JSON.stringify(records, null, 2))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
