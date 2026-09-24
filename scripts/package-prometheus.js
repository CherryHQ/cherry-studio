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
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of entries) {
    const from = path.join(source, entry)
    if (fs.existsSync(from))
      fs.cpSync(from, path.join(destination, entry), {
        recursive: true,
        dereference: true,
        filter: (filename) =>
          !/(?:^|[\\/])(?:node_modules|__tests__|\.git)(?:[\\/]|$)|\.test\.[cm]?[jt]s$/.test(filename)
      })
  }
  for (const filename of files) fs.copyFileSync(path.join(source, filename), path.join(destination, filename))
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
  for (const file of inventory(path.join(destination, 'skills'))) {
    if (!file.path.endsWith('.md')) continue
    const filename = path.join(destination, 'skills', file.path)
    const text = fs.readFileSync(filename, 'utf8').replace(/\bnode scripts\/([a-zA-Z0-9_./-]+\.mjs)\b/g, 'boss-mini $1')
    fs.writeFileSync(filename, text)
  }
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

module.exports = { packagePrometheus }
if (require.main === module) packagePrometheus()
