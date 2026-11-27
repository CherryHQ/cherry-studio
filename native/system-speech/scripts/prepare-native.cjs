const { readdirSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const { buildNativeHelper } = require('./build-native.cjs')

function swiftSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    return entry.isDirectory() ? swiftSources(file) : entry.name.endsWith('.swift') ? [file] : []
  })
}

function prepareNativeHelper({
  platform = process.platform,
  arch = process.arch,
  packageRoot = resolve(__dirname, '..'),
  build = buildNativeHelper
} = {}) {
  if (!(platform === 'win32' && arch === 'x64') && !(platform === 'darwin' && ['arm64', 'x64'].includes(arch)))
    return null

  const helperPath = join(
    packageRoot,
    'dist',
    'native',
    `${platform}-${arch}`,
    platform === 'win32' ? 'cherry-system-speech.exe' : 'cherry-system-speech'
  )
  const sources = [
    join(packageRoot, 'scripts', 'build-native.cjs'),
    ...(platform === 'win32'
      ? [join(packageRoot, 'windows', 'SystemSpeechHelper.cpp'), join(packageRoot, 'windows', 'build.cmd')]
      : [join(packageRoot, 'native', 'Package.swift'), ...swiftSources(join(packageRoot, 'native', 'Sources'))])
  ]
  const helper = statSync(helperPath, { throwIfNoEntry: false })
  if (
    helper?.isFile() &&
    helper.size > 0 &&
    (platform === 'win32' || (helper.mode & 0o100) !== 0) &&
    sources.every((file) => statSync(file).mtimeMs <= helper.mtimeMs)
  )
    return { helperPath, rebuilt: false }

  return { helperPath: build(arch, platform), rebuilt: true }
}

exports.prepareNativeHelper = prepareNativeHelper

if (require.main === module) {
  const result = prepareNativeHelper()
  if (result) process.stdout.write(`System speech helper ${result.rebuilt ? 'built' : 'ready'}: ${result.helperPath}\n`)
}
