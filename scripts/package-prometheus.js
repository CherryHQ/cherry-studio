const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const source = path.join(root, 'resources', 'prometheus-skills-mini')
const destination = path.join(root, 'build', 'prometheus-payload')
const entries = [
  'skills',
  'scripts',
  'lib',
  'rules',
  'references',
  'agents',
  'templates',
  'hooks',
  'docker',
  'commands',
  'shared',
  'docs',
  'schemas',
  'assets',
  'config',
  '.agents/skills'
]
const files = ['package.json', 'package-lock.json', 'versions.toml']

function inventory(directory, prefix = '') {
  return fs.readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) return inventory(directory, relative)
    return [
      {
        path: relative.split(path.sep).join('/'),
        sha256: crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(directory, relative)))
          .digest('hex')
      }
    ]
  })
}

function renderPackSkills(payload) {
  const skillRoot = path.join(payload, 'skills')
  if (!fs.existsSync(skillRoot)) return
  for (const file of inventory(skillRoot)) {
    if (!file.path.endsWith('.md')) continue
    const filename = path.join(skillRoot, file.path)
    const skill = file.path.split('/')[0]
    const text = fs
      .readFileSync(filename, 'utf8')
      .replace(/\bnode scripts\/([a-zA-Z0-9_./-]+\.mjs)\b/g, (command, helper) =>
        fs.existsSync(path.join(skillRoot, skill, 'scripts', helper)) ? command : `boss-mini ${helper}`
      )
    fs.writeFileSync(filename, text)
  }
}

/** Materialize the source-controlled runtime, including each skill's scripts and data, without network access. */
function copyPrometheusPayload(sourceRoot, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true })
  for (const entry of entries) {
    const from = path.join(sourceRoot, entry)
    if (fs.existsSync(from))
      fs.cpSync(from, path.join(destinationRoot, entry), {
        recursive: true,
        dereference: true,
        filter: (filename) =>
          !/(?:^|[\\/])(?:node_modules|__tests__|\.git)(?:[\\/]|$)|\.test\.[cm]?[jt]s$/.test(filename)
      })
  }
  for (const filename of files) fs.copyFileSync(path.join(sourceRoot, filename), path.join(destinationRoot, filename))
  renderPackSkills(destinationRoot)
  return { files: inventory(destinationRoot) }
}

function packagePrometheus() {
  const artifacts = JSON.parse(fs.readFileSync(path.join(root, 'build', 'integration-artifacts.json'), 'utf8'))
  const revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const gitlink = execFileSync('git', ['ls-tree', 'HEAD', 'resources/prometheus-skills-mini'], {
    cwd: root,
    encoding: 'utf8'
  })
    .trim()
    .split(/\s+/)[2]
  if (revision !== gitlink) throw new Error('Commit the mini submodule pin before packaging the release')
  if (revision !== artifacts.sources.mini.revision)
    throw new Error('The packaged mini revision does not match the pinned integration revision')
  fs.rmSync(destination, { recursive: true, force: true })
  copyPrometheusPayload(source, destination)
  const literSource = path.join(source, 'tools', 'liter-llm')
  const literCatalogDestination = path.join(destination, 'catalogs', 'liter-llm')
  const literRevision = execFileSync('git', ['-C', literSource, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (literRevision !== artifacts.sources['liter-llm'].revision)
    throw new Error('The liter-llm catalog source does not match the pinned integration revision')
  fs.mkdirSync(literCatalogDestination, { recursive: true })
  for (const [sourceName, artifactName] of [
    ['providers.json', 'providers'],
    ['catalog.json', 'models']
  ]) {
    const sourceFile = path.join(literSource, 'schemas', sourceName)
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex')
    if (checksum !== artifacts.catalogs['liter-llm'][artifactName])
      throw new Error(`The liter-llm ${artifactName} catalog checksum does not match the integration manifest`)
    fs.copyFileSync(sourceFile, path.join(literCatalogDestination, sourceName))
  }
  fs.writeFileSync(
    path.join(literCatalogDestination, 'catalog-manifest.json'),
    `${JSON.stringify(
      {
        schema: 1,
        repository: artifacts.sources['liter-llm'].repository,
        revision: literRevision,
        providersSha256: artifacts.catalogs['liter-llm'].providers,
        catalogSha256: artifacts.catalogs['liter-llm'].models
      },
      null,
      2
    )}\n`
  )

  // OpenSpec's exact dependency graph comes from mini's checked-in npm lock. The
  // runtime includes its JS dependencies; no install step runs on the user's PC.
  const npm = process.env.npm_execpath
  if (npm && npm.endsWith('npm-cli.js'))
    execFileSync(process.execPath, [npm, 'ci', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund'], {
      cwd: destination,
      stdio: 'inherit'
    })
  else if (process.platform === 'win32') {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    execFileSync(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund'], {
      cwd: destination,
      stdio: 'inherit'
    })
  } else
    execFileSync('npm', ['ci', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund'], {
      cwd: destination,
      stdio: 'inherit'
    })
  fs.rmSync(path.join(destination, 'node_modules', '.bin'), { recursive: true, force: true })
  if (!fs.existsSync(path.join(destination, 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js')))
    throw new Error('npm ci did not install the OpenSpec backend')
  // electron-builder drops a top-level node_modules from extraResources; the installer restores the name.
  fs.renameSync(path.join(destination, 'node_modules'), path.join(destination, 'pack_modules'))
  const compass = path.join(root, 'build', 'compass-skills')
  const archive = path.join(root, 'build', 'compass-skills.download')
  if (!artifacts.compassSkills?.sha256 || !artifacts.compassSkills?.url)
    throw new Error('Compass skill archive is not pinned')
  require('./download-binaries').download(artifacts.compassSkills.url, archive)
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  if (checksum !== artifacts.compassSkills.sha256) throw new Error('Compass skills checksum mismatch')
  fs.rmSync(compass, { recursive: true, force: true })
  fs.mkdirSync(compass, { recursive: true })
  execFileSync('tar', ['xzf', archive, '-C', compass, '--strip-components=1'], { stdio: 'inherit' })
  fs.rmSync(archive)
  for (const skill of fs.readdirSync(compass))
    fs.cpSync(path.join(compass, skill), path.join(destination, 'skills', skill), { recursive: true })
  const skills = fs
    .readdirSync(path.join(destination, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(destination, 'skills', entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort()
  renderPackSkills(destination)
  // The existing builtin synchronizer discovers this directory and registers every
  // skill for agent runtimes. Keep the runnable dependencies in the adjacent pack.
  for (const skill of skills)
    fs.cpSync(path.join(destination, 'skills', skill), path.join(root, 'resources', 'skills', skill), {
      recursive: true
    })
  const manifest = {
    schema: 1,
    revision,
    skills,
    tools: Object.fromEntries(artifacts.tools.map((tool) => [tool.name, tool.version])),
    sources: artifacts.sources,
    images: artifacts.images,
    files: inventory(destination)
  }
  fs.writeFileSync(path.join(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Packaged mini ${revision}: ${skills.length} skills and ${manifest.files.length} runtime files`)
}

module.exports = { packagePrometheus, copyPrometheusPayload }
if (require.main === module) packagePrometheus()
