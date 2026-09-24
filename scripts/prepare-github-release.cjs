const { spawnSync } = require('node:child_process')

const version = require('../package.json').version
const tag = `v${version}`
const repository = process.env.GITHUB_REPOSITORY

const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repository], { encoding: 'utf8' })
if (existing.status === 0) {
  console.log(`Using existing GitHub Release ${tag}`)
  process.exit(0)
}

const notes = [
  `The Boss ${version} — supervised Universal Agent Runtime, workspace-bound tools, and the complete Prometheus skill payload.`,
  '',
  'Installers are published incrementally by platform. See RELEASES.md for checksums and signing status.'
].join('\n')
const created = spawnSync(
  'gh',
  [
    'release',
    'create',
    tag,
    '--repo',
    repository,
    '--target',
    process.env.GITHUB_SHA,
    '--title',
    `The Boss ${version}`,
    '--notes',
    notes,
    '--draft'
  ],
  { encoding: 'utf8' }
)
process.stdout.write(created.stdout || '')
process.stderr.write(created.stderr || '')
if (created.status !== 0) throw new Error(`Unable to create GitHub Release ${tag}`)
