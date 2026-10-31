const fs = require('node:fs')

const { GLOBAL_EDITION, getReleaseDownloadGroups } = require('./edition')
const { readBuilderReleaseNotes } = require('./hotfix-release-notes')

const PLATFORMS = [
  { id: 'windows', label: 'Windows' },
  { id: 'mac', label: 'macOS' },
  { id: 'linux', label: 'Linux' }
]

function createDownloadTable({ productName, repository, tag }) {
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  const lines = [`## Downloads (${tag})`, '', '| Platform | Architecture | Download |', '| --- | --- | --- |']

  for (const platform of PLATFORMS) {
    const groups = getReleaseDownloadGroups({ edition: GLOBAL_EDITION, platform: platform.id, productName, version })
    if (platform.id === 'mac') groups.reverse()

    for (const { architecture, artifacts } of groups) {
      const architectureLabel =
        platform.id === 'mac' ? (architecture === 'arm64' ? 'Apple silicon (arm64)' : 'Intel (x64)') : architecture
      const downloads = artifacts
        .map(({ fileName, label }) => {
          const url = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`
          return `[${label}](${url})`
        })
        .join(' · ')
      lines.push(`| ${platform.label} | ${architectureLabel} | ${downloads} |`)
    }
  }

  return lines.join('\n')
}

function createReleaseNotes(curatedNotes) {
  const start = '<!--LANG:en-->'
  const content = curatedNotes
    .slice(curatedNotes.indexOf(start) + start.length, curatedNotes.indexOf('<!--LANG:zh-CN-->'))
    .trim()

  return `<details>\n<summary>Release Notes</summary>\n\n${content}\n\n</details>`
}

function composeReleaseBody({ builderContent, generatedNotes, productName, repository, tag }) {
  const curatedNotes = readBuilderReleaseNotes(builderContent).releaseNotes.trim()
  const changes = generatedNotes?.trim() || ''

  if (!curatedNotes) throw new Error('electron-builder.yml release notes are empty')
  const body = `${createDownloadTable({ productName, repository, tag })}\n\n${createReleaseNotes(curatedNotes)}`
  if (!changes) return `${body}\n`

  return `${body}\n\n${changes}\n`
}

function main() {
  const [builderPath, generatedNotesPath, outputPath, repository, tag, productName] = process.argv.slice(2)
  if (!builderPath || !generatedNotesPath || !outputPath || !repository || !tag || !productName) {
    throw new Error(
      'Usage: compose-release-body.js <electron-builder.yml> <generated-notes.md> <output.md> <repository> <tag> <product-name>'
    )
  }

  const body = composeReleaseBody({
    builderContent: fs.readFileSync(builderPath, 'utf8'),
    generatedNotes: generatedNotesPath === '-' ? '' : fs.readFileSync(generatedNotesPath, 'utf8'),
    productName,
    repository,
    tag
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
