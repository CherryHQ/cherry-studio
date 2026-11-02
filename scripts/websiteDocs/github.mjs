import { randomUUID } from 'node:crypto'

import { fetchRevision, git, repositories, sha } from './content.mjs'

export const stateBranch = 'docs-sync-state'
export const syncBranch = 'docs-sync/content'
export const statePath = '.github/website-docs-sync-state.json'

export async function api(endpoint, method = 'GET', body, allowMissing = false) {
  const response = await fetch(`https://api.github.com/${endpoint}`, {
    method,
    signal: AbortSignal.timeout(60_000),
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  if (response.status === 404 && allowMissing) return null
  if (!response.ok) throw new Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}`)
  return response.status === 204 ? {} : response.json()
}

export async function head(side, branch = 'main') {
  const ref = await api(`repos/${repositories[side]}/git/ref/heads/${branch}`, 'GET', undefined, true)
  return ref ? sha(ref.object.sha) : null
}

export async function latestPr(side) {
  const prs = await api(
    `repos/${repositories[side]}/pulls?state=all&head=CherryHQ:${syncBranch}&base=main&sort=created&direction=desc&per_page=1`
  )
  if (!Array.isArray(prs)) throw new Error('Cannot read synchronization pull requests')
  return prs[0]
}

export async function managedHead(side, pr) {
  const commit = await api(`repos/${repositories[side]}/commits/${sha(pr.head.sha)}`)
  const managed =
    commit?.commit.verification.verified &&
    commit?.author?.type === 'Bot' &&
    (!process.env.DOCS_SYNC_BOT_LOGIN || commit.author.login === process.env.DOCS_SYNC_BOT_LOGIN) &&
    commit.commit.message.includes('Docs-Sync-Result: ')
  return managed ? pr.head.sha : null
}

export async function freshness(side, revision, state, description) {
  await api(`repos/${repositories[side]}/statuses/${sha(revision)}`, 'POST', {
    context: 'website-docs/freshness',
    state,
    description,
    ...(process.env.GITHUB_RUN_ID
      ? { target_url: `https://github.com/${repositories.desktop}/actions/runs/${process.env.GITHUB_RUN_ID}` }
      : {})
  })
}

export async function signedCommit(side, branch, expected, files, headline, details) {
  const login = process.env.DOCS_SYNC_BOT_LOGIN
  if (!process.env.GH_TOKEN || !login?.endsWith('[bot]'))
    throw new Error('GitHub App token and DOCS_SYNC_BOT_LOGIN are required for writes')
  const user = await api(`users/${encodeURIComponent(login)}`)
  if (!user?.id) throw new Error('Cannot resolve the synchronization App identity')
  const result = await api('graphql', 'POST', {
    query: 'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}',
    variables: {
      input: {
        branch: { repositoryNameWithOwner: repositories[side], branchName: branch },
        expectedHeadOid: sha(expected),
        fileChanges: files,
        message: {
          headline,
          body: `${details}\n\nSigned-off-by: ${login} <${user.id}+${login}@users.noreply.github.com>`
        }
      }
    }
  })
  if (result?.errors) throw new Error(JSON.stringify(result.errors))
  const oid = sha(result?.data?.createCommitOnBranch?.commit?.oid)
  const committed = await api(`repos/${repositories[side]}/commits/${oid}`)
  if (!committed?.commit.verification.verified) throw new Error('Synchronization commit is not Verified')
  return oid
}

export async function createBranch(side, branch, revision) {
  const result = await api(`repos/${repositories[side]}/git/refs`, 'POST', {
    ref: `refs/heads/${branch}`,
    sha: sha(revision)
  })
  if (!result?.object) throw new Error(`Cannot create ${branch}`)
}

export async function replaceBranch(repo, side, expected, parent, files, result) {
  const temporary = `docs-sync/build-${randomUUID()}`
  await createBranch(side, temporary, parent)
  try {
    const oid = await signedCommit(
      side,
      temporary,
      parent,
      files,
      'docs(website-docs): synchronize shared content',
      `Docs-Sync-Result: ${result}`
    )
    const remote = `https://github.com/${repositories[side]}.git`
    fetchRevision(repo, remote, oid)
    git(repo, [
      'push',
      `--force-with-lease=refs/heads/${syncBranch}:${expected ?? ''}`,
      remote,
      `${oid}:refs/heads/${syncBranch}`
    ])
    return oid
  } finally {
    await api(`repos/${repositories[side]}/git/refs/heads/${temporary}`, 'DELETE')
  }
}
