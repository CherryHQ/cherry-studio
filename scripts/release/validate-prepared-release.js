const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const { gt: semverGt, prerelease: semverPrerelease, valid: semverValid } = require('semver')
const { parse: parseYaml } = require('yaml')

function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function readBaseFile(cwd, filePath) {
  return runGit(cwd, ['show', `HEAD:${filePath}`])
}

function changedPaths(cwd) {
  const tracked = runGit(cwd, ['diff', 'HEAD', '--name-only', '--no-renames', '-z']).split('\0').filter(Boolean)
  const untracked = runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
  return [...new Set([...tracked, ...untracked])].sort()
}

function validateReleaseNotes(releaseNotes) {
  const normalizedReleaseNotes = releaseNotes.trim()
  const markers = ['<!--LANG:en-->', '<!--LANG:zh-CN-->', '<!--LANG:END-->']
  const indexes = markers.map((marker) => normalizedReleaseNotes.indexOf(marker))
  if (
    indexes.some((index) => index < 0) ||
    markers.some((marker, markerIndex) => normalizedReleaseNotes.indexOf(marker, indexes[markerIndex] + 1) >= 0) ||
    indexes[0] >= indexes[1] ||
    indexes[1] >= indexes[2]
  ) {
    throw new Error('Release notes must contain one ordered set of bilingual markers')
  }

  const english = normalizedReleaseNotes.slice(indexes[0] + markers[0].length, indexes[1])
  const chinese = normalizedReleaseNotes.slice(indexes[1] + markers[1].length, indexes[2])
  if (!english.trim() || !chinese.trim()) {
    throw new Error('Release notes must contain non-empty English and Chinese sections')
  }
}

function validatePreparedRelease({ cwd, includeGeneratedManifest = false, targetVersion }) {
  if (!semverValid(targetVersion)) throw new Error(`Invalid target version: ${targetVersion}`)

  const stableRelease = semverPrerelease(targetVersion) === null
  const expectedPaths = stableRelease
    ? ['electron-builder.yml', 'package.json', 'resources/cherry-studio/release-history.json']
    : ['electron-builder.yml', 'package.json']
  if (includeGeneratedManifest) {
    expectedPaths.push('resources/builtin-agents/cherry-assistant/product-manifest.json')
    expectedPaths.sort()
  }
  const actualPaths = changedPaths(cwd)
  assert.deepStrictEqual(actualPaths, expectedPaths, 'Release preparation changed an unexpected set of source files')
  for (const filePath of actualPaths) {
    if (!fs.lstatSync(path.join(cwd, filePath)).isFile()) {
      throw new Error(`Release preparation change is not a regular file: ${filePath}`)
    }
  }

  const basePackage = JSON.parse(readBaseFile(cwd, 'package.json'))
  const preparedPackage = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
  if (!semverValid(basePackage.version) || !semverGt(targetVersion, basePackage.version)) {
    throw new Error(`Target version ${targetVersion} must be greater than ${basePackage.version}`)
  }
  if (preparedPackage.version !== targetVersion) {
    throw new Error(`Prepared package version ${preparedPackage.version} does not match ${targetVersion}`)
  }
  const packageWithoutVersion = { ...preparedPackage, version: basePackage.version }
  assert.deepStrictEqual(packageWithoutVersion, basePackage, 'package.json may change only the version field')

  const baseBuilder = parseYaml(readBaseFile(cwd, 'electron-builder.yml'))
  const preparedBuilder = parseYaml(fs.readFileSync(path.join(cwd, 'electron-builder.yml'), 'utf8'))
  const baseReleaseNotes = baseBuilder?.releaseInfo?.releaseNotes
  const preparedReleaseNotes = preparedBuilder?.releaseInfo?.releaseNotes
  if (typeof baseReleaseNotes !== 'string' || typeof preparedReleaseNotes !== 'string') {
    throw new Error('electron-builder.yml must contain string release notes')
  }
  preparedBuilder.releaseInfo.releaseNotes = baseReleaseNotes
  assert.deepStrictEqual(preparedBuilder, baseBuilder, 'electron-builder.yml may change only releaseInfo.releaseNotes')
  validateReleaseNotes(preparedReleaseNotes)

  const baseHistory = JSON.parse(readBaseFile(cwd, 'resources/cherry-studio/release-history.json'))
  const preparedHistory = JSON.parse(
    fs.readFileSync(path.join(cwd, 'resources/cherry-studio/release-history.json'), 'utf8')
  )
  if (!stableRelease) {
    assert.deepStrictEqual(preparedHistory, baseHistory, 'Prerelease preparation must not change release history')
    return
  }

  const [newEntry, ...remainingEntries] = preparedHistory
  if (!newEntry || newEntry.version !== targetVersion) {
    throw new Error(`Stable release history must start with ${targetVersion}`)
  }
  assert.deepStrictEqual(Object.keys(newEntry).sort(), ['releaseNotes', 'version'])
  if (newEntry.releaseNotes.trimEnd() !== preparedReleaseNotes.trimEnd()) {
    throw new Error('Stable release history notes must exactly match electron-builder.yml')
  }
  assert.deepStrictEqual(
    remainingEntries,
    baseHistory.filter((entry) => entry.version !== targetVersion),
    'Stable release preparation must preserve existing release history entries'
  )
}

function main() {
  const versionFlag = process.argv.indexOf('--target-version')
  const targetVersion = versionFlag >= 0 ? process.argv[versionFlag + 1] : undefined
  if (!targetVersion) throw new Error('--target-version is required')
  validatePreparedRelease({
    cwd: process.cwd(),
    includeGeneratedManifest: process.argv.includes('--include-generated-manifest'),
    targetVersion
  })
  console.log(`Validated release metadata for ${targetVersion}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { changedPaths, validatePreparedRelease, validateReleaseNotes }
