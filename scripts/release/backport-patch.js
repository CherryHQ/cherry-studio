const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')

const MAX_BUFFER = 128 * 1024 * 1024

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER }).trim()
}

function succeeds(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER }).status === 0
}

function resolvePatchBase({ cwd, mergeSha, prCommitCount, prNumber, getAssociatedPullRequests }) {
  if (!Number.isInteger(prCommitCount) || prCommitCount < 1) {
    throw new Error(`Invalid pull request commit count: ${prCommitCount}`)
  }

  const parents = run('git', ['show', '-s', '--format=%P', mergeSha], cwd).split(/\s+/).filter(Boolean)
  if (parents.length === 0 || parents.length > 2) {
    throw new Error(`Unsupported merged commit parent count for ${mergeSha}: ${parents.length}`)
  }

  let patchBase = parents[0]
  if (parents.length === 1 && prCommitCount > 1) {
    let currentSha = mergeSha
    for (let index = 1; index < prCommitCount; index += 1) {
      const parentSha = run('git', ['rev-parse', `${currentSha}^1`], cwd)
      if (!getAssociatedPullRequests(parentSha).includes(prNumber)) break

      currentSha = parentSha
      patchBase = run('git', ['rev-parse', `${currentSha}^1`], cwd)
    }
  }

  return patchBase
}

function applyBackportPatch({ cwd, mergeSha, patchBase, patchFile }) {
  const patch = execFileSync('git', ['diff', '--binary', '--full-index', patchBase, mergeSha, '--'], {
    cwd,
    maxBuffer: MAX_BUFFER
  })
  fs.writeFileSync(patchFile, patch)

  if (patch.length === 0 || succeeds('git', ['apply', '--reverse', '--check', patchFile], cwd)) {
    return { hasChanges: false, status: 'already-present' }
  }

  const application = spawnSync('git', ['apply', '--3way', '--index', patchFile], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER
  })
  const unmergedPaths = run('git', ['diff', '--name-only', '--diff-filter=U'], cwd)
  if (application.status !== 0 || unmergedPaths) {
    const diagnostics = [
      application.error?.message,
      application.stdout?.trim(),
      application.stderr?.trim(),
      unmergedPaths && `Unmerged paths:\n${unmergedPaths}`
    ]
      .filter(Boolean)
      .join('\n')
      .slice(-8000)
    execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd, stdio: 'ignore' })
    throw new Error(
      `The merged hotfix result conflicts with the active release branch.${diagnostics ? `\n${diagnostics}` : ''}`
    )
  }

  if (succeeds('git', ['diff', '--cached', '--quiet'], cwd)) {
    return { hasChanges: false, status: 'already-present' }
  }

  return { hasChanges: true, status: 'applied' }
}

function prepareBackport({ cwd, mergeSha, prCommitCount, prNumber, patchFile, getAssociatedPullRequests }) {
  if (!succeeds('git', ['merge-base', '--is-ancestor', mergeSha, 'origin/main'], cwd)) {
    throw new Error(`Merged commit ${mergeSha} is not on origin/main`)
  }

  const patchBase = resolvePatchBase({ cwd, mergeSha, prCommitCount, prNumber, getAssociatedPullRequests })
  return { patchBase, ...applyBackportPatch({ cwd, mergeSha, patchBase, patchFile }) }
}

function appendOutput(outputFile, key, value) {
  fs.appendFileSync(outputFile, `${key}=${value}\n`)
}

function main() {
  const { GITHUB_OUTPUT, MERGE_SHA, PR_COMMIT_COUNT, PR_NUMBER, REPO, RUNNER_TEMP } = process.env
  if (!GITHUB_OUTPUT || !MERGE_SHA || !PR_COMMIT_COUNT || !PR_NUMBER || !REPO || !RUNNER_TEMP) {
    throw new Error('Missing required backport workflow environment')
  }

  const result = prepareBackport({
    cwd: process.cwd(),
    mergeSha: MERGE_SHA,
    prCommitCount: Number(PR_COMMIT_COUNT),
    prNumber: Number(PR_NUMBER),
    patchFile: `${RUNNER_TEMP}/hotfix.patch`,
    getAssociatedPullRequests(commitSha) {
      const response = run(
        'gh',
        ['api', '--paginate', '--slurp', `repos/${REPO}/commits/${commitSha}/pulls?per_page=100`],
        process.cwd()
      )
      return JSON.parse(response)
        .flat()
        .map((pullRequest) => pullRequest.number)
    }
  })

  appendOutput(GITHUB_OUTPUT, 'has-changes', String(result.hasChanges))
  appendOutput(GITHUB_OUTPUT, 'patch-base', result.patchBase)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    if (process.env.RUNNER_TEMP) {
      fs.writeFileSync(`${process.env.RUNNER_TEMP}/backport-failure-message`, error.message)
    }
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { applyBackportPatch, prepareBackport, resolvePatchBase }
