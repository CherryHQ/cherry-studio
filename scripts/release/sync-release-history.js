const fs = require('node:fs')

const { readBuilderReleaseNotes } = require('./hotfix-release-notes')

function syncReleaseHistory({ builderPath, historyPath, version }) {
  if (version.includes('-')) return null

  const { releaseNotes } = readBuilderReleaseNotes(fs.readFileSync(builderPath, 'utf8'))
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8')).filter((entry) => entry.version !== version)
  history.unshift({ version, releaseNotes })
  fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`)

  return releaseNotes
}

function main() {
  const versionFlag = process.argv.indexOf('--target-version')
  const version = versionFlag >= 0 ? process.argv[versionFlag + 1] : undefined
  if (!version) throw new Error('--target-version is required')

  const synced = syncReleaseHistory({
    builderPath: 'electron-builder.yml',
    historyPath: 'resources/cherry-studio/release-history.json',
    version
  })
  console.log(synced ? `Synced release history for ${version}` : `Skipped release history for prerelease ${version}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { syncReleaseHistory }
