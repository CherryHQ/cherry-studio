const semver = require('semver')
const { packageVersion, publishedOnLine, releaseVersion, versionLine } = require('./prepare-release-line')
const { readReleaseLines, requireSupportedLine } = require('./release-lines')

async function resolveLineBuild({ github, repo, branch, sha }) {
  const config = await readReleaseLines(github, repo)
  if (config.mode === 'exact-version') {
    if (!branch.startsWith('release/v')) return null
    const version = releaseVersion(branch.slice('release/v'.length))
    if ((await packageVersion(github, repo, sha)) !== version)
      throw new Error('Release branch and package version disagree')
    return { mode: config.mode, tag: `v${version}` }
  }
  if (!/^release\/\d+\.\d+\.x$/.test(branch)) return null
  const line = branch.slice('release/'.length)
  requireSupportedLine(config, line)
  const version = await packageVersion(github, repo, sha)
  if (versionLine(version) !== line) return null
  const tag = `v${version}`
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 })
  if (releases.some((release) => release.tag_name === tag && !release.draft)) return null
  const earlier = (release) => semver.lt(release.tag_name.slice(1), version)
  const baseline =
    publishedOnLine(releases, line).find(earlier) ||
    (line === config.candidate && publishedOnLine(releases, config.current).find(earlier))
  if (!baseline) throw new Error(`No published baseline for ${tag}`)
  return { mode: config.mode, tag, baselineTag: baseline.tag_name }
}

module.exports = { resolveLineBuild }
