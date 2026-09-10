const { spawnSync } = require('node:child_process')
const semver = require('semver')
const { packageVersion, releaseVersion, versionLine } = require('./prepare-release-line')
const { readReleaseLines, requireSupportedLine } = require('./release-lines')

function includesCommit(sha, head, cwd) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', sha, head], { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr)
  return result.status === 0
}

async function planLinePublication({ github, repo, branch, sha, cwd = process.cwd() }) {
  const config = await readReleaseLines(github, repo)
  if (config.mode === 'exact-version') {
    if (!branch.startsWith('release/v')) throw new Error('Exact-version publication requires release/v<version>')
    return { mode: config.mode, tag: `v${releaseVersion(branch.slice('release/v'.length))}`, pending: [] }
  }
  const line = branch.slice('release/'.length)
  requireSupportedLine(config, line)
  const version = await packageVersion(github, repo, sha)
  if (versionLine(version) !== line) throw new Error('Release branch and package version disagree')
  const tag = `v${version}`
  const prs = await github.paginate(github.rest.pulls.list, { ...repo, base: branch, state: 'all', per_page: 100 })
  const pending = prs
    .filter((pr) => pr.milestone?.title === tag && (!pr.merged_at || !includesCommit(pr.merge_commit_sha, sha, cwd)))
    .map((pr) => pr.html_url)
  return { mode: config.mode, tag, pending }
}

function latestStableRelease(releases) {
  return releases
    .filter((release) => {
      if (release.draft || release.prerelease || !release.published_at || !release.tag_name?.startsWith('v'))
        return false
      try {
        return !semver.prerelease(releaseVersion(release.tag_name.slice(1)))
      } catch {
        return false
      }
    })
    .sort((a, b) => semver.rcompare(a.tag_name.slice(1), b.tag_name.slice(1)))[0]
}

async function updateLatestRelease({ github, repo }) {
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 })
  const latest = latestStableRelease(releases)
  if (!latest) return
  await github.rest.repos.updateRelease({
    ...repo,
    release_id: latest.id,
    tag_name: latest.tag_name,
    make_latest: 'true'
  })
  return latest.tag_name
}

module.exports = { latestStableRelease, planLinePublication, updateLatestRelease }
