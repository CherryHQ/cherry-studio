const { spawnSync } = require('node:child_process')

const version = require('../package.json').version
const { resolveReleaseProfile } = require('./release-profile.cjs')
const tag = `v${version}`
const repository = process.env.GITHUB_REPOSITORY
const profile = resolveReleaseProfile()

const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repository], { encoding: 'utf8' })
if (existing.status === 0) {
  console.log(`Using existing GitHub Release ${tag}`)
  process.exit(0)
}

const notes = [
  `The Boss ${version} — workspace-bound tools, managed services, and the complete Prometheus skill payload.`,
  '',
  `Feature profile: ${profile.id}. UAR is unavailable in this release while its sidecar packaging is corrected.`,
  'Installers are published for Windows x64, Windows ARM64, Apple Silicon, and Intel macOS. See RELEASES.md for checksums and signing status.'
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
