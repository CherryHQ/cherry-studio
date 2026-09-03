const fs = require('node:fs')

const { readBuilderReleaseNotes } = require('./hotfix-release-notes')

function composeReleaseBody({ builderContent, generatedNotes }) {
  const curatedNotes = readBuilderReleaseNotes(builderContent).releaseNotes.trim()
  const changes = generatedNotes?.trim() || ''

  if (!curatedNotes) throw new Error('electron-builder.yml release notes are empty')
  if (!changes) return `${curatedNotes}\n`

  return `${curatedNotes}\n\n---\n\n${changes}\n`
}

function main() {
  const [builderPath, generatedNotesPath, outputPath] = process.argv.slice(2)
  if (!builderPath || !generatedNotesPath || !outputPath) {
    throw new Error('Usage: compose-release-body.js <electron-builder.yml> <generated-notes.md> <output.md>')
  }

  const body = composeReleaseBody({
    builderContent: fs.readFileSync(builderPath, 'utf8'),
    generatedNotes: generatedNotesPath === '-' ? '' : fs.readFileSync(generatedNotesPath, 'utf8')
  })
  fs.writeFileSync(outputPath, body)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { composeReleaseBody }
