const { spawnSync } = require('node:child_process')

const version = require('../package.json').version
const { resolveReleaseProfile } = require('./release-profile.cjs')
const tag = `v${version}`
const repository = process.env.GITHUB_REPOSITORY
const profile = resolveReleaseProfile()
const profileNote = profile.uarEnabled
  ? `Feature profile: ${profile.id}. Includes the complete pinned UAR sidecar payload for Windows x64 and Apple Silicon.`
  : `Feature profile: ${profile.id}. UAR is unavailable in this customer release while its sidecar packaging is corrected.`

const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'body', '--jq', '.body'], {
  encoding: 'utf8'
})
if (existing.status === 0) {
  const existingProfile = existing.stdout.match(/^Feature profile: ([a-z-]+)\./m)?.[1]
  if (existingProfile !== profile.id) {
    throw new Error(`GitHub Release ${tag} already belongs to feature profile ${existingProfile || 'unknown'}`)
  }
  console.log(`Using existing GitHub Release ${tag}`)
  process.exit(0)
}

const notes = [
  `The Boss ${version} — workspace-bound tools, managed services, and the complete Prometheus skill payload.`,
  '',
  profileNote,
  `Installers are published for ${profile.supportedPlatforms.join(', ')}. See RELEASES.md for checksums and signing status.`
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
