const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim()
}
function api(endpoint) {
  return JSON.parse(gh(['api', endpoint]))
}

function validateSourceRun(run, { repository, tag, sha, allPlatforms = false }) {
  const selection = /^Release build (all|windows|mac|linux) release\/(v\S+) @ ([0-9a-f]{40})$/.exec(
    run.display_title || ''
  )
  if (
    !selection ||
    selection[2] !== tag ||
    run.head_repository?.full_name !== repository ||
    run.head_branch !== 'main' ||
    run.path !== '.github/workflows/release.yml' ||
    run.event !== 'workflow_dispatch' ||
    (sha && selection[3] !== sha) ||
    (allPlatforms && selection[1] !== 'all')
  ) {
    throw new Error('Artifact source must be a matching release.yml build from this repository and SHA')
  }
  return selection[3]
}

function selectArchive(artifacts, { tag, sha, excludedRunId }) {
  return artifacts
    .filter(
      (artifact) =>
        artifact.name === `release-bundle-${tag}` &&
        !artifact.expired &&
        artifact.releaseSha === sha &&
        String(artifact.workflow_run.id) !== String(excludedRunId)
    )
    .sort((a, b) => b.id - a.id)[0]
}

function validatePublishedRelease(release, tag, sha, tagSha) {
  if (release.draft !== false || release.tag_name !== tag || release.target_commitish !== sha || tagSha !== sha) {
    throw new Error('Sync requires a published GitHub release and tag matching the archive SHA')
  }
}

function main() {
  const command = process.argv[2]
  const { GH_REPO: repository, TAG: tag, RELEASE_SHA: sha } = process.env
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag || '')) throw new Error('A release tag is required')
  let runId = process.env.SOURCE_RUN_ID
  let archive
  if (command === 'baseline') {
    const pages = JSON.parse(
      gh([
        'api',
        '--paginate',
        '--slurp',
        `repos/${repository}/actions/artifacts?name=release-bundle-${tag}&per_page=100`
      ])
    )
    const candidates = pages.flatMap((page) => page.artifacts)
    const sourceRuns = new Map()
    for (const artifact of candidates) {
      if (artifact.expired || String(artifact.workflow_run?.id) === process.env.GITHUB_RUN_ID) continue
      const sourceId = artifact.workflow_run?.id
      if (!sourceId) continue
      if (!sourceRuns.has(sourceId)) sourceRuns.set(sourceId, api(`repos/${repository}/actions/runs/${sourceId}`))
      try {
        artifact.releaseSha = validateSourceRun(sourceRuns.get(sourceId), { repository, tag, sha })
      } catch {
        // Other release commits cannot provide a retry baseline.
      }
    }
    archive = selectArchive(candidates, { tag, sha, excludedRunId: process.env.GITHUB_RUN_ID })
    if (!archive) throw new Error('No complete unexpired archive for this SHA; run an all-platform build')
    runId = String(archive.workflow_run.id)
  } else if (command !== 'sync' || !/^\d+$/.test(runId || '')) {
    throw new Error('sync-only requires the original release run_id')
  }
  const run = api(`repos/${repository}/actions/runs/${runId}`)
  const releaseSha = validateSourceRun(run, { repository, tag, sha, allPlatforms: command === 'sync' })
  if (!archive) {
    const pages = JSON.parse(
      gh(['api', '--paginate', '--slurp', `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`])
    )
    archive = selectArchive(
      pages.flatMap((page) => page.artifacts).map((artifact) => ({ ...artifact, releaseSha })),
      { tag, sha: releaseSha }
    )
    if (!archive) throw new Error('Release archive is missing or expired; it cannot be rebuilt by sync-only')
  }
  if (command === 'sync') {
    const release = api(`repos/${repository}/releases/tags/${tag}`)
    const tagSha = gh(['api', `repos/${repository}/commits/${tag}`, '--jq', '.sha'])
    validatePublishedRelease(release, tag, releaseSha, tagSha)
  }
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `run-id=${runId}\nsha=${releaseSha}\nartifact-id=${archive.id}\ntag=${tag}\n`
  )
}
if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
module.exports = { selectArchive, validatePublishedRelease, validateSourceRun }
