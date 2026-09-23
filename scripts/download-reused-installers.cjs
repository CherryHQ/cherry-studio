const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const version = require('../package.json').version
const manifests = path.join(root, 'manifests')
const allowed = new Set(['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'])
const runs = (process.env.REUSE_INSTALLER_RUNS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const reused = (process.env.REUSE_PLATFORMS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const built = (process.env.BUILT_PLATFORMS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

if (runs.length !== reused.length)
  throw new Error('reuse_installer_runs and reuse_platforms must contain the same number of values')
if (new Set([...built, ...reused]).size !== built.length + reused.length)
  throw new Error('A platform cannot be built and reused in the same release run')

async function main() {
  for (let index = 0; index < reused.length; index += 1) {
    const target = reused[index]
    const run = runs[index]
    if (!/^\d+$/.test(run) || !allowed.has(target)) throw new Error(`Invalid reused installer: ${run}/${target}`)
    const destination = path.join(manifests, `.reuse-${target}`)
    fs.mkdirSync(destination, { recursive: true })
    const download = spawnSync(
      'gh',
      [
        'run',
        'download',
        run,
        '--repo',
        process.env.GITHUB_REPOSITORY,
        '--name',
        `installers-${target}`,
        '--dir',
        destination
      ],
      { encoding: 'utf8' }
    )
    if (download.status !== 0)
      throw new Error(download.stderr || `Unable to download installers-${target} from run ${run}`)
    const files = fs.readdirSync(destination).filter((name) => name.endsWith('.json'))
    if (files.length !== 1) throw new Error(`Expected one manifest for ${target}, found ${files.length}`)
    const sourceFile = path.join(destination, files[0])
    const entry = JSON.parse(fs.readFileSync(sourceFile))
    const [platform, arch] = target.split('-')
    const expectedArtifacts = platform === 'linux' ? 3 : 1
    if (
      entry.platform !== platform ||
      entry.arch !== arch ||
      entry.version !== version ||
      !/^[0-9a-f]{40}$/i.test(entry.source) ||
      entry.artifacts?.length !== expectedArtifacts
    )
      throw new Error(`Reused manifest does not match ${target} v${version}`)
    for (const artifact of entry.artifacts) {
      const response = await fetch(artifact.url, { method: 'HEAD', signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error(`Reused artifact unavailable: ${artifact.name}, HTTP ${response.status}`)
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length !== artifact.size)
        throw new Error(`Reused artifact size mismatch: ${artifact.name}`)
    }
    fs.copyFileSync(sourceFile, path.join(manifests, `installers-${target}.json`))
  }

  const releasePlatforms = [...built, ...reused]
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `release_platforms=${releasePlatforms.join(',')}\nreused_platforms=${reused.join(',')}\n`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
