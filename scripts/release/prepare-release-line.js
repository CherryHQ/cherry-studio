const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const { readReleaseLines, requireSupportedLine } = require('./release-lines')

function releaseVersion(value) {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value) ||
    !semver.valid(value)
  ) {
    throw new Error(`Invalid release version: ${value}`)
  }
  return value
}

function versionLine(version) {
  releaseVersion(version)
  return `${semver.major(version)}.${semver.minor(version)}.x`
}

async function getRef(github, repo, ref) {
  try {
    return (await github.rest.git.getRef({ ...repo, ref })).data.object.sha
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

async function packageVersion(github, repo, sha) {
  const { data } = await github.rest.repos.getContent({ ...repo, path: 'package.json', ref: sha })
  return releaseVersion(JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')).version)
}

function publishedOnLine(releases, line) {
  return releases
    .filter((release) => {
      if (release.draft || !release.published_at || !release.tag_name?.startsWith('v')) return false
      try {
        return versionLine(release.tag_name.slice(1)) === line
      } catch {
        return false
      }
    })
    .sort((a, b) => semver.rcompare(a.tag_name.slice(1), b.tag_name.slice(1)))
}

async function planLinePreparation({ github, repo, line = '', requestedVersion, mainSha }) {
  const config = await readReleaseLines(github, repo)
  if (config.mode === 'exact-version') {
    if (line) throw new Error('Minor-line preparation is not enabled')
    return { mode: config.mode, sourceSha: mainSha }
  }
  requireSupportedLine(config, line)
  const branch = `release/${line}`
  const head = await getRef(github, repo, `heads/${branch}`)
  if (!head && line !== config.candidate) throw new Error(`Missing maintained release branch ${branch}`)
  const sourceSha = head || mainSha
  const sourceVersion = await packageVersion(github, repo, sourceSha)
  const version = releaseVersion(
    requestedVersion === 'patch' && versionLine(sourceVersion) === line
      ? semver.inc(sourceVersion, 'patch')
      : requestedVersion
  )
  if (versionLine(version) !== line || !semver.gt(version, sourceVersion))
    throw new Error(`Version ${version} must advance ${sourceVersion} within ${line}`)
  if (line !== config.candidate && semver.prerelease(version))
    throw new Error('Maintained lines prepare stable patches only')
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 })
  const baseline =
    publishedOnLine(releases, line)[0] || (line === config.candidate && publishedOnLine(releases, config.current)[0])
  if (!baseline || !semver.gt(version, baseline.tag_name.slice(1)))
    throw new Error(`Version ${version} must follow a published baseline`)
  if (
    releases.some((release) => release.tag_name === `v${version}`) ||
    (await getRef(github, repo, `tags/v${version}`))
  )
    throw new Error(`Version v${version} already exists`)
  return { mode: config.mode, line, branch, sourceSha, version, baselineTag: baseline.tag_name, cut: !head }
}

async function openLinePreparation({ github, repo, plan, additions }) {
  const branch = `release-prep/${plan.line}/v${plan.version}`
  const { data: publisher } = await github.rest.users.getAuthenticated()
  const signoff = `Signed-off-by: ${publisher.login} <${publisher.id}+${publisher.login}@users.noreply.github.com>`
  const title = `chore(release): prepare v${plan.version}`
  if (plan.cut) await github.rest.git.createRef({ ...repo, ref: `refs/heads/${plan.branch}`, sha: plan.sourceSha })
  await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: plan.sourceSha })
  const result = await github.graphql(
    `mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) { commit { oid } }
  }`,
    {
      input: {
        branch: { repositoryNameWithOwner: `${repo.owner}/${repo.repo}`, branchName: branch },
        expectedHeadOid: plan.sourceSha,
        message: { headline: title, body: signoff },
        fileChanges: { additions }
      }
    }
  )
  const { data: commit } = await github.rest.repos.getCommit({ ...repo, ref: result.createCommitOnBranch.commit.oid })
  if (!commit.commit.verification.verified || !commit.commit.message.split('\n').includes(signoff))
    throw new Error('Preparation commit must be GitHub Verified and DCO-signed off')
  const body = fs
    .readFileSync(path.join(__dirname, '../../.github/pull_request_template.md'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace('Before this PR:', `Before this PR:\n\nPrepare the next release on ${plan.branch}.`)
    .replace(
      'After this PR:',
      `After this PR:\n\nPrepare v${plan.version} from source ${plan.sourceSha}, with notes since ${plan.baselineTag}.`
    )
    .replace('Fixes #', 'Fixes # N/A')
    .replace(
      'The following tradeoffs were made:',
      'The following tradeoffs were made:\n\nOnly release metadata changes; product fixes use separate backport PRs.'
    )
    .replace(
      'The following alternatives were considered:',
      'The following alternatives were considered:\n\nDirect metadata commits would bypass review.'
    )
    .replace('Links to places where the discussion took place:', 'Links to places where the discussion took place: N/A')
    .replace('If this PR introduces breaking changes, please describe the changes and the impact on users.', 'None.')
    .replace(
      '### Special notes for your reviewer',
      '### Special notes for your reviewer\n\nReview the bilingual notes and reconcile any changes merged after preparation through normal PR review and CI.'
    )
    .replace(/```release-note[\s\S]*?```/, '```release-note\nNONE\n```')
  return (await github.rest.pulls.create({ ...repo, head: branch, base: plan.branch, title, body })).data
}

module.exports = {
  openLinePreparation,
  packageVersion,
  planLinePreparation,
  publishedOnLine,
  releaseVersion,
  versionLine
}
