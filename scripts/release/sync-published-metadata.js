const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const { readBuilderReleaseNotes } = require('./hotfix-release-notes')
const { releaseVersion } = require('./prepare-release-line')

function syncPublishedMetadata({ cwd, tag }) {
  const version = releaseVersion(tag.slice(1))
  const taggedPackage = JSON.parse(execFileSync('git', ['show', `${tag}:package.json`], { cwd, encoding: 'utf8' }))
  if (taggedPackage.version !== version) throw new Error('Published tag and package version disagree')
  const packagePath = path.join(cwd, 'package.json')
  const mainPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  const advance = semver.gt(version, mainPackage.version)
  const builderPath = path.join(cwd, 'electron-builder.yml')
  const { releaseNotes } = readBuilderReleaseNotes(
    execFileSync('git', ['show', `${tag}:electron-builder.yml`], { cwd, encoding: 'utf8' })
  )
  if (!semver.prerelease(version)) {
    const historyPath = path.join(cwd, 'resources/cherry-studio/release-history.json')
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8')).filter((entry) => entry.version !== version)
    history.push({ version, releaseNotes })
    history.sort((a, b) => semver.rcompare(a.version, b.version))
    fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`)
  }
  if (advance) {
    fs.writeFileSync(packagePath, `${JSON.stringify({ ...mainPackage, version }, null, 2)}\n`)
    const block = readBuilderReleaseNotes(fs.readFileSync(builderPath, 'utf8'))
    const replacement = releaseNotes
      .split('\n')
      .map((line) => (line ? `    ${line}` : ''))
      .join('\n')
    fs.writeFileSync(
      builderPath,
      [...block.lines.slice(0, block.start), replacement, ...block.lines.slice(block.end)].join('\n')
    )
  }
  return advance
}

if (require.main === module)
  process.stdout.write(String(syncPublishedMetadata({ cwd: process.cwd(), tag: process.argv[2] })))

module.exports = { syncPublishedMetadata }
