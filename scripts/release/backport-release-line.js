const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { prepareBackport } = require('./backport-patch')
const { backportIdentity, readReleaseLines, requireSupportedLine } = require('./release-lines')

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, maxBuffer: 128 * 1024 * 1024 })
}

function gitText(cwd, ...args) {
  return git(cwd, ...args)
    .toString('utf8')
    .trim()
}

async function findRef(github, repo, branch) {
  try {
    return (await github.rest.git.getRef({ ...repo, ref: `heads/${branch}` })).data.object.sha
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

async function findBackport(github, repo, source, line) {
  const prs = await github.paginate(github.rest.pulls.list, {
    ...repo,
    state: 'all',
    head: `${repo.owner}:backport/${line}/pr-${source}`,
    per_page: 100
  })
  for (const pr of prs) {
    const identity = backportIdentity(pr, `${repo.owner}/${repo.repo}`)
    if (!identity || identity.source !== source || identity.line !== line) {
      throw new Error('Existing backport pull request has inconsistent provenance')
    }
  }
  return prs.find((pr) => pr.merged_at) || prs.find((pr) => pr.state === 'open') || prs[0]
}

async function setState(github, repo, source, line, state) {
  const states = { open: 'backport-open', merged: 'backported', failed: 'backport-failed' }
  const label = `${states[state]}/${line}`
  await github.rest.issues
    .createLabel({
      ...repo,
      name: label,
      color: state === 'merged' ? '0E8A16' : state === 'open' ? 'FBCA04' : 'B60205'
    })
    .catch((error) => {
      if (error.status !== 422 || !error.response?.data?.errors?.some((entry) => entry.code === 'already_exists'))
        throw error
    })
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: source })
  for (const prefix of Object.values(states)) {
    const name = `${prefix}/${line}`
    if (name !== label && pr.labels.some((entry) => entry.name === name)) {
      await github.rest.issues.removeLabel({ ...repo, issue_number: source, name })
    }
  }
  if (!pr.labels.some((entry) => entry.name === label)) {
    await github.rest.issues.addLabels({ ...repo, issue_number: source, labels: [label] })
  }
}

function backportBody(pr, line) {
  const note = /```release-note\s*\n([\s\S]*?)```/.exec(pr.body || '')?.[1].trim() || 'NONE'
  return fs
    .readFileSync(path.join(__dirname, '../../.github/pull_request_template.md'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      'Before this PR:',
      `Before this PR:\n\n${pr.html_url} is merged into main but has not reached release/${line}.`
    )
    .replace(
      'After this PR:',
      `After this PR:\n\nThe source change is backported to release/${line} for independent review and CI.`
    )
    .replace('Fixes #', 'N/A')
    .replace(
      'The following tradeoffs were made:',
      'The following tradeoffs were made:\n\nOnly the source PR change is applied; conflicts require maintainer adaptation.'
    )
    .replace(
      'The following alternatives were considered:',
      'The following alternatives were considered:\n\nMerging all of main would import unrelated changes.'
    )
    .replace(
      'Links to places where the discussion took place:',
      `Links to places where the discussion took place: ${pr.html_url}`
    )
    .replace(
      'If this PR introduces breaking changes, please describe the changes and the impact on users.',
      'None intended. Review compatibility on the target line.'
    )
    .replace(
      '### Special notes for your reviewer',
      `### Special notes for your reviewer\n\nSource commit: ${pr.merge_commit_sha}. Assign the exact release milestone to this backport PR.`
    )
    .replace(/```release-note[\s\S]*?```/, () => `\`\`\`release-note\n${note}\n\`\`\``)
    .concat(`\n<!-- release-backport-source-pr: ${pr.number} -->\n`)
}

async function preparePatch(github, repo, pr, cwd, patchFile) {
  const associated = new Map()
  const parents = gitText(cwd, 'show', '-s', '--format=%P', pr.merge_commit_sha).split(' ')
  if (parents.length === 1 && pr.commits > 1) {
    let sha = pr.merge_commit_sha
    for (let index = 1; index < pr.commits; index += 1) {
      sha = gitText(cwd, 'rev-parse', `${sha}^1`)
      const prs = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
        ...repo,
        commit_sha: sha,
        per_page: 100
      })
      associated.set(
        sha,
        prs.map((entry) => entry.number)
      )
      if (!associated.get(sha).includes(pr.number)) break
    }
  }
  return prepareBackport({
    cwd,
    mergeSha: pr.merge_commit_sha,
    prCommitCount: pr.commits,
    prNumber: pr.number,
    patchFile,
    getAssociatedPullRequests: (sha) => associated.get(sha) || []
  })
}

function fileChanges(cwd) {
  const additions = []
  const deletions = []
  for (const file of git(cwd, 'diff', '--cached', '--name-only', '--no-renames', '-z')
    .toString('utf8')
    .split('\0')
    .filter(Boolean)) {
    if (!gitText(cwd, 'ls-files', '--stage', '--', file)) deletions.push({ path: file })
    else additions.push({ path: file, contents: git(cwd, 'show', `:${file}`).toString('base64') })
  }
  return { additions, deletions }
}

async function reconcileLineBackport({ github, repo, source, line, retry = false, cwd = process.cwd() }) {
  const config = await readReleaseLines(github, repo)
  if (config.mode !== 'minor-line') return { status: 'disabled' }
  const getSource = async () => (await github.rest.pulls.get({ ...repo, pull_number: source })).data
  const pr = await getSource()
  if (pr.base.ref !== 'main' || !pr.merged_at) return { status: 'unmerged' }
  const existing = await findBackport(github, repo, source, line)
  if (existing) {
    let current = (await github.rest.pulls.get({ ...repo, pull_number: existing.number })).data
    if (retry && !current.merged_at && current.state === 'closed') {
      requireSupportedLine(config, line)
      if (!pr.labels.some((label) => label.name === `target/${line}`)) return { status: 'withdrawn' }
      current = (await github.rest.pulls.update({ ...repo, pull_number: current.number, state: 'open' })).data
    }
    const state = current.merged_at ? 'merged' : current.state === 'open' ? 'open' : 'failed'
    await setState(github, repo, source, line, state)
    return { status: state, url: current.html_url }
  }
  if (!pr.labels.some((label) => label.name === `target/${line}`)) return { status: 'withdrawn' }
  const branch = `backport/${line}/pr-${source}`
  const releaseBranch = `release/${line}`
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'line-backport-'))
  const worktree = path.join(root, 'repo')
  const hooks = path.join(root, 'hooks')
  fs.mkdirSync(hooks)
  let added = false
  try {
    requireSupportedLine(config, line)
    const releaseSha = await findRef(github, repo, releaseBranch)
    if (!releaseSha) throw new Error(`Missing release branch ${releaseBranch}`)
    const branchSha = await findRef(github, repo, branch)
    git(cwd, 'fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main', `refs/heads/${releaseBranch}`)
    if (branchSha) git(cwd, 'fetch', 'origin', `refs/heads/${branch}`)
    let baseSha = branchSha || releaseSha
    let recovered = null
    if (branchSha && spawnSync('git', ['merge-base', '--is-ancestor', branchSha, releaseSha], { cwd }).status !== 0) {
      recovered = (await github.rest.repos.getCommit({ ...repo, ref: branchSha })).data
      if (
        !recovered.commit.verification.verified ||
        !/^Signed-off-by: .+ <[^<>\s]+>$/m.test(recovered.commit.message) ||
        recovered.parents.length !== 1 ||
        !recovered.commit.message.includes(`\nSource: ${pr.merge_commit_sha}\n`) ||
        !recovered.commit.message.includes(`\nBackport: #${source} to ${releaseBranch}\n`)
      ) {
        throw new Error('Unrecognized orphan backport branch; preserve it and recover manually')
      }
      baseSha = recovered.parents[0].sha
      if (spawnSync('git', ['merge-base', '--is-ancestor', baseSha, releaseSha], { cwd }).status !== 0) {
        throw new Error('Orphan backport is not based on the target release line')
      }
    }
    git(cwd, '-c', `core.hooksPath=${hooks}`, 'worktree', 'add', '--detach', worktree, baseSha)
    added = true
    const result = await preparePatch(github, repo, pr, worktree, path.join(root, 'source.patch'))
    const revalidate = async () => {
      requireSupportedLine(await readReleaseLines(github, repo), line)
      const latest = await getSource()
      if (
        !latest.merged_at ||
        latest.base.ref !== 'main' ||
        latest.merge_commit_sha !== pr.merge_commit_sha ||
        !latest.labels.some((label) => label.name === `target/${line}`)
      )
        throw new Error('Backport request changed; retry from current state')
      if ((await findRef(github, repo, releaseBranch)) !== releaseSha)
        throw new Error('Release branch moved; retry from current state')
    }
    await revalidate()
    if (!result.hasChanges) {
      await setState(github, repo, source, line, 'merged')
      return { status: 'already-present' }
    }
    // Release metadata is prepared per version, not copied from main during a backport.
    const changes = fileChanges(worktree)
    const metadata = [
      'electron-builder.yml',
      'resources/cherry-studio/release-history.json',
      'resources/builtin-agents/cherry-assistant/product-manifest.json'
    ]
    if ([...changes.additions, ...changes.deletions].some((entry) => metadata.includes(entry.path))) {
      throw new Error('Source patch changes release metadata; adapt it manually on the target line')
    }
    const baseVersion = JSON.parse(gitText(worktree, 'show', 'HEAD:package.json')).version
    if (JSON.parse(gitText(worktree, 'show', ':package.json')).version !== baseVersion) {
      throw new Error('Source patch changes the release version; adapt it manually')
    }
    if (recovered) {
      if (gitText(worktree, 'write-tree') !== recovered.commit.tree.sha) {
        throw new Error('Orphan backport differs from the source patch; preserve it and recover manually')
      }
    } else {
      const { data: publisher } = await github.rest.users.getAuthenticated()
      const email = `${publisher.id}+${publisher.login}@users.noreply.github.com`
      const message = {
        headline: `fix(release): backport #${source} to ${line}`,
        body: `Backport: #${source} to ${releaseBranch}\n\nSource: ${pr.merge_commit_sha}\n\nSigned-off-by: ${publisher.login} <${email}>`
      }
      if (!branchSha) await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: baseSha })
      const response = await github.graphql(
        `mutation($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) { commit { oid } }
      }`,
        {
          input: {
            branch: { repositoryNameWithOwner: `${repo.owner}/${repo.repo}`, branchName: branch },
            expectedHeadOid: baseSha,
            message,
            fileChanges: changes
          }
        }
      )
      const sha = response.createCommitOnBranch.commit.oid
      recovered = (await github.rest.repos.getCommit({ ...repo, ref: sha })).data
      if (!recovered.commit.verification.verified) throw new Error('Backport commit is not GitHub Verified')
    }
    await revalidate()
    if ((await findRef(github, repo, branch)) !== recovered.sha)
      throw new Error('Backport branch changed before PR creation')
    const { data: created } = await github.rest.pulls.create({
      ...repo,
      base: releaseBranch,
      head: branch,
      title: `fix(release): backport #${source} to ${line}`,
      body: backportBody(pr, line)
    })
    await setState(github, repo, source, line, 'open')
    return { status: 'open', url: created.html_url }
  } catch (error) {
    const latest = await getSource()
    if (latest.labels.some((label) => label.name === `target/${line}`)) {
      const current = await findBackport(github, repo, source, line)
      await setState(
        github,
        repo,
        source,
        line,
        current?.merged_at ? 'merged' : current?.state === 'open' ? 'open' : 'failed'
      )
    }
    throw error
  } finally {
    if (added) git(cwd, '-c', `core.hooksPath=${hooks}`, 'worktree', 'remove', '--force', worktree)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

module.exports = { backportBody, reconcileLineBackport }
