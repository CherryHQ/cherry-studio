const fs = require('node:fs')

const { EDITIONS, getReleaseDownloadGroups } = require('./edition')
const { readBuilderReleaseNotes } = require('./hotfix-release-notes')

const LANGUAGES = [
  { end: '<!--LANG:zh-CN-->', label: 'English', start: '<!--LANG:en-->' },
  { end: '<!--LANG:END-->', label: '简体中文', start: '<!--LANG:zh-CN-->' }
]
const PLATFORMS = [
  { id: 'windows', label: 'Windows' },
  { id: 'mac', label: 'macOS' },
  { id: 'linux', label: 'Linux' }
]

function createDownloadTable({ productName, repository, tag }) {
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  const lines = [
    `## Downloads / 下载 (${tag})`,
    '',
    '| Platform | Architecture | Global | China Edition |',
    '| --- | --- | --- | --- |'
  ]

  for (const platform of PLATFORMS) {
    const editionGroups = EDITIONS.map((edition) =>
      getReleaseDownloadGroups({ edition, platform: platform.id, productName, version })
    )

    for (let index = 0; index < editionGroups[0].length; index += 1) {
      const architecture = editionGroups[0][index].architecture
      const downloads = editionGroups.map((groups) =>
        groups[index].artifacts
          .map(({ fileName, label }) => {
            const url = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`
            return `[${label}](${url})`
          })
          .join(' · ')
      )
      lines.push(`| ${platform.label} | ${architecture} | ${downloads[0]} | ${downloads[1]} |`)
    }
  }

  return lines.join('\n')
}

function createReleaseNotes(curatedNotes) {
  const sections = LANGUAGES.map(({ end, label, start }) => {
    const content = curatedNotes.slice(curatedNotes.indexOf(start) + start.length, curatedNotes.indexOf(end)).trim()
    return `<details>\n<summary>${label}</summary>\n\n${content}\n\n</details>`
  })

  return `## Release Notes / 发布说明\n\n${sections.join('\n\n')}`
}

function composeReleaseBody({ builderContent, generatedNotes, productName, repository, tag }) {
  const curatedNotes = readBuilderReleaseNotes(builderContent).releaseNotes.trim()
  const changes = generatedNotes?.trim() || ''

  if (!curatedNotes) throw new Error('electron-builder.yml release notes are empty')
  const body = `${createDownloadTable({ productName, repository, tag })}\n\n${createReleaseNotes(curatedNotes)}`
  if (!changes) return `${body}\n`

  return `${body}\n\n---\n\n${changes}\n`
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
