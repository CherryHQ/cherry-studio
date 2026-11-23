const fs = require('node:fs')

function validateReleaseBranchHead({ branchSha, workflowSha }) {
  if (branchSha !== workflowSha) {
    throw new Error(`Release branch moved away from selected workflow commit ${workflowSha}`)
  }
}

function validatePreparationState({ releasePages, tag }) {
  const matchingReleases = releasePages.flat().filter((release) => release.tag_name === tag)
  if (matchingReleases.length > 0) {
    throw new Error(`Release ${tag} already exists; delete or rename it before preparing this version`)
  }
}

function validateBuildStart({ branchSha, platform, release, remoteTagSha, tag, workflowSha }) {
  validateReleaseBranchHead({ branchSha, workflowSha })
  if (release && release.draft !== true) {
    throw new Error(`Release ${tag} is already published; create a new version instead`)
  }
  if (!release && remoteTagSha && remoteTagSha !== workflowSha) {
    throw new Error(`Tag ${tag} exists without a draft release and points to another commit`)
  }
  if (platform !== 'all' && (!release || remoteTagSha !== workflowSha)) {
    throw new Error(`A single-platform retry requires an existing draft whose tag already points to ${workflowSha}`)
  }
}

function validateDraftUpload({ branchSha, release, tag, workflowSha }) {
  validateReleaseBranchHead({ branchSha, workflowSha })
  if (!release) throw new Error(`Draft release ${tag} is missing`)
  if (release && release.draft !== true) {
    throw new Error(
      `Release ${tag} was published while its tag was being prepared; refusing any post-publication tag mutation`
    )
  }
  if (release && release.tag_name !== tag) {
    throw new Error(`Draft release ${release.tag_name} does not match ${tag}`)
  }
  if (release && release.target_commitish !== workflowSha) {
    throw new Error(`Draft release ${tag} does not target ${workflowSha}`)
  }
}

function validateBuildCompletion(state) {
  validateDraftUpload(state)
  const { release, tag } = state
  if (release && (!Array.isArray(release.assets) || release.assets.length === 0)) {
    throw new Error(`Draft release ${tag} has no artifacts`)
  }
}

function validateDraftArtifacts({ release, files }) {
  const expected = Object.entries(files)
    .filter(([name]) => name.startsWith('global/') || name.startsWith('common/'))
    .map(([name, entry]) => [name.split('/').at(-1), entry.size])
  const assets = new Map(release.assets.map((asset) => [asset.name, asset.size]))
  if (
    expected.length === 0 ||
    new Set(expected.map(([name]) => name)).size !== expected.length ||
    expected.length !== release.assets.length ||
    assets.size !== release.assets.length ||
    expected.some(([name, size]) => !size || assets.get(name) !== size)
  ) {
    throw new Error('GitHub draft attachments do not match the complete COS inventory')
  }
}

function validatePublishState({
  branchSha,
  controlSha,
  buildRun,
  expectedBuildTitle,
  jobResults,
  openReleasePullRequests,
  pendingHotfixes,
  release,
  tag,
  tagSha,
  workflowSha
}) {
  if (!release || release.draft !== true) {
    throw new Error(`Release ${tag} must exist and still be a draft before publication`)
  }
  if (release.target_commitish !== workflowSha) {
    throw new Error(`Draft release ${tag} does not target ${workflowSha}`)
  }
  if (tagSha !== workflowSha || branchSha !== workflowSha) {
    throw new Error('Tag, release branch, and selected workflow commit must be identical before publication')
  }
  if (openReleasePullRequests.trim()) {
    throw new Error(`Release branch still has open pull requests:\n${openReleasePullRequests}`)
  }
  if (pendingHotfixes.trim()) {
    throw new Error(`Merged hotfix pull requests are still waiting for this release:\n${pendingHotfixes}`)
  }
  if (
    !buildRun ||
    buildRun.display_title !== expectedBuildTitle ||
    buildRun.head_sha !== controlSha ||
    buildRun.head_branch !== 'main' ||
    buildRun.path !== '.github/workflows/release.yml' ||
    buildRun.event !== 'workflow_dispatch' ||
    !jobResults ||
    ['prepare', 'release', 'release-cn', 'finalize-build', 'approve'].some(
      (job) => jobResults[job]?.result !== 'success'
    )
  ) {
    throw new Error(`No successful all-platform Release build exists for ${workflowSha}`)
  }
  if (!Array.isArray(release.assets) || release.assets.length === 0) {
    throw new Error(`Draft release ${tag} has no artifacts`)
  }
  if (!release.body?.trim()) {
    throw new Error(`Draft release ${tag} has no release notes`)
  }
}

function parseOptionalJson(value, name) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`)
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (value === undefined) throw new Error(`${name} is required`)
  return value
}

function main() {
  const phase = process.argv[2]
  const release = parseOptionalJson(process.env.RELEASE_JSON, 'RELEASE_JSON')
  const tag = requiredEnvironment('TAG')

  if (phase === 'draft-artifacts') {
    validateDraftArtifacts({ release, files: JSON.parse(fs.readFileSync('cos-release.json', 'utf8')).files })
    return
  }

  if (phase === 'prepare') {
    validatePreparationState({
      // Avoid Node 24.21.0's UTF-8 pipe-read overflow: https://github.com/nodejs/node/issues/66341.
      releasePages: parseOptionalJson(fs.readFileSync(0).toString('utf8'), 'release list'),
      tag
    })
    return
  }
  if (phase === 'build-start') {
    validateBuildStart({
      branchSha: requiredEnvironment('BRANCH_SHA'),
      release,
      platform: requiredEnvironment('PLATFORM'),
      remoteTagSha: process.env.REMOTE_TAG_SHA || '',
      tag,
      workflowSha: requiredEnvironment('WORKFLOW_SHA')
    })
    return
  }
  if (phase === 'build-completion' || phase === 'draft-upload') {
    const validate = phase === 'draft-upload' ? validateDraftUpload : validateBuildCompletion
    validate({
      branchSha: requiredEnvironment('BRANCH_SHA'),
      release,
      tag,
      workflowSha: requiredEnvironment('WORKFLOW_SHA')
    })
    return
  }
  if (phase === 'publish') {
    validatePublishState({
      branchSha: requiredEnvironment('BRANCH_SHA'),
      controlSha: requiredEnvironment('CONTROL_SHA'),
      buildRun: parseOptionalJson(process.env.BUILD_RUN_JSON, 'BUILD_RUN_JSON'),
      expectedBuildTitle: requiredEnvironment('EXPECTED_BUILD_TITLE'),
      jobResults: parseOptionalJson(process.env.RELEASE_JOB_RESULTS, 'RELEASE_JOB_RESULTS'),
      openReleasePullRequests: process.env.OPEN_RELEASE_PULL_REQUESTS || '',
      pendingHotfixes: process.env.PENDING_HOTFIXES || '',
      release,
      tag,
      tagSha: requiredEnvironment('TAG_SHA'),
      workflowSha: requiredEnvironment('WORKFLOW_SHA')
    })
    return
  }

  throw new Error(`Unsupported release-state validation phase: ${phase || '<missing>'}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = {
  validateBuildCompletion,
  validateBuildStart,
  validateDraftArtifacts,
  validateDraftUpload,
  validatePreparationState,
  validatePublishState
}
