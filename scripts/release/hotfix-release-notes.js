const fs = require('node:fs')

const LANGUAGE_MARKERS = ['<!--LANG:en-->', '<!--LANG:zh-CN-->', '<!--LANG:END-->']

function extractHotfixReleaseNote(prBody) {
  const blocks = [...prBody.matchAll(/```release-note[ \t]*\r?\n([\s\S]*?)\r?\n```/g)]
  if (blocks.length > 1) throw new Error('A hotfix PR may contain at most one release-note block')
  if (blocks.length === 0) return null

  const content = blocks[0][1].replace(/\r\n/g, '\n').trim()
  if (content === 'NONE') return null

  const markerIndexes = LANGUAGE_MARKERS.map((marker) => content.indexOf(marker))
  if (
    markerIndexes.some((index) => index < 0) ||
    markerIndexes.some((index, markerIndex) => content.indexOf(LANGUAGE_MARKERS[markerIndex], index + 1) >= 0) ||
    markerIndexes[0] !== 0 ||
    markerIndexes[0] >= markerIndexes[1] ||
    markerIndexes[1] >= markerIndexes[2] ||
    content.slice(markerIndexes[2] + LANGUAGE_MARKERS[2].length).trim()
  ) {
    throw new Error('Hotfix release notes must use the exact English and Chinese language markers')
  }

  const english = content.slice(markerIndexes[0] + LANGUAGE_MARKERS[0].length, markerIndexes[1]).trim()
  const chinese = content.slice(markerIndexes[1] + LANGUAGE_MARKERS[1].length, markerIndexes[2]).trim()
  const linePattern = /^\[[^\]\r\n]+\] \S[^\r\n]*$/u
  if (!linePattern.test(english) || !linePattern.test(chinese)) {
    throw new Error('Each hotfix language section must contain one [Component] release-note line')
  }
  if (!/\p{Script=Han}/u.test(chinese.slice(chinese.indexOf('] ') + 2))) {
    throw new Error('The Chinese hotfix release-note description must contain Chinese content')
  }

  return { english, chinese }
}

function appendBugFix(releaseNotes, startMarker, endMarker, heading, followingHeadings, item) {
  const lines = releaseNotes.split('\n')
  const startIndex = lines.indexOf(startMarker)
  const endIndex = lines.indexOf(endMarker)
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Release notes are missing ${startMarker} or ${endMarker}`)
  }

  if (lines.slice(startIndex + 1, endIndex).includes(`- ${item}`)) return releaseNotes

  const headingIndex = lines.indexOf(heading, startIndex + 1)
  if (headingIndex > startIndex && headingIndex < endIndex) {
    let lastItemIndex = headingIndex
    for (let index = headingIndex + 1; index < endIndex; index += 1) {
      if (lines[index].startsWith('- ')) {
        lastItemIndex = index
      } else if (lines[index].trim()) {
        break
      }
    }
    lines.splice(lastItemIndex + 1, 0, `- ${item}`)
  } else {
    const followingIndex = lines.findIndex(
      (line, index) => index > startIndex && index < endIndex && followingHeadings.includes(line)
    )
    lines.splice(followingIndex >= 0 ? followingIndex : endIndex, 0, heading, `- ${item}`, '')
  }

  return lines.join('\n')
}

function readBuilderReleaseNotes(content) {
  const lines = content.split('\n')
  const headerIndexes = lines.flatMap((line, index) => (line === '  releaseNotes: |' ? [index] : []))
  if (headerIndexes.length !== 1)
    throw new Error('electron-builder.yml must contain one releaseInfo.releaseNotes block')

  const start = headerIndexes[0] + 1
  let end = start
  while (end < lines.length && (!lines[end] || lines[end].startsWith('    '))) end += 1
  const releaseNotes = lines
    .slice(start, end)
    .map((line) => (line ? line.slice(4) : ''))
    .join('\n')
    .replace(/\n+$/, '')

  return { end, lines, releaseNotes, start }
}

function updateHotfixReleaseMetadata({ builderPath, historyPath, prBody, version }) {
  const note = extractHotfixReleaseNote(prBody)
  if (!note) return null

  const builderContent = fs.readFileSync(builderPath, 'utf8')
  const block = readBuilderReleaseNotes(builderContent)
  let releaseNotes = appendBugFix(
    block.releaseNotes,
    LANGUAGE_MARKERS[0],
    LANGUAGE_MARKERS[1],
    '🐛 Bug Fixes',
    ['💄 Improvements', '⚡ Performance'],
    note.english
  )
  releaseNotes = appendBugFix(
    releaseNotes,
    LANGUAGE_MARKERS[1],
    LANGUAGE_MARKERS[2],
    '🐛 问题修复',
    ['💄 改进', '⚡ 性能优化'],
    note.chinese
  )

  const replacement = releaseNotes
    .split('\n')
    .map((line) => (line ? `    ${line}` : ''))
    .join('\n')
  const updatedBuilder = [...block.lines.slice(0, block.start), replacement, ...block.lines.slice(block.end)].join('\n')
  let updatedHistory

  if (!version.includes('-')) {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'))
    const entry = history.find((candidate) => candidate.version === version)
    if (!entry) throw new Error(`Stable release history does not contain ${version}`)
    if (typeof entry.releaseNotes !== 'string' || entry.releaseNotes.trimEnd() !== block.releaseNotes.trimEnd()) {
      throw new Error(`Release history for ${version} does not match electron-builder.yml`)
    }
    entry.releaseNotes = releaseNotes
    updatedHistory = `${JSON.stringify(history, null, 2)}\n`
  }

  fs.writeFileSync(builderPath, updatedBuilder)
  if (updatedHistory) fs.writeFileSync(historyPath, updatedHistory)

  return note
}

function main() {
  const prBody = process.env.PR_BODY
  if (prBody === undefined) throw new Error('PR_BODY is required')

  extractHotfixReleaseNote(prBody)
  if (process.argv.includes('--check')) return

  const packageManifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  updateHotfixReleaseMetadata({
    builderPath: 'electron-builder.yml',
    historyPath: 'resources/cherry-studio/release-history.json',
    prBody,
    version: packageManifest.version
  })
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    if (process.env.RUNNER_TEMP) {
      fs.writeFileSync(`${process.env.RUNNER_TEMP}/backport-failure-message`, error.message)
    }
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { appendBugFix, extractHotfixReleaseNote, readBuilderReleaseNotes, updateHotfixReleaseMetadata }
