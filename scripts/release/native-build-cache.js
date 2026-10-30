const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const { createTask, restoreTask, saveTask, recordTiming } = require('./build-cache')

function nativeTask({ root, name, arch, platform, electronVersion, inputs, outputs }) {
  if (process.env.CHERRY_BUILD_CACHE !== '1' || platform !== 'darwin' || process.platform !== platform) return null
  // Windows runners do not yet expose a verified compiler/SDK identity.
  try {
    const query = (...args) => execFileSync('xcrun', args, { encoding: 'utf8' }).trim()
    const flags = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(CC|CXX|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS|SDKROOT|DEVELOPER_DIR|MACOSX_DEPLOYMENT_TARGET|npm_config_)/i.test(
          key
        )
      )
    )
    return createTask({
      root,
      name,
      inputs: [
        ...inputs,
        'pnpm-lock.yaml',
        'package.json',
        'patches',
        'scripts/release/native-build-cache.js',
        'scripts/release/build-cache.js'
      ],
      outputs,
      identity: {
        platform,
        arch,
        electronVersion,
        node: process.version,
        flagsDigest: createHash('sha256').update(JSON.stringify(flags)).digest('hex'),
        compiler: query('clang++', '--version'),
        swift: query('swift', '--version'),
        sdk: query('--show-sdk-version'),
        sdkBuild: query('--show-sdk-build-version'),
        developer: execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim()
      }
    })
  } catch {
    return null
  }
}

function validArchitecture(options) {
  if (options.platform !== 'darwin') return true
  try {
    const expected = options.arch === 'x64' ? 'x86_64' : options.arch
    return options.outputs.every((output) => {
      const file = path.join(options.root, output)
      if (path.basename(file) === '.forge-meta') {
        return new RegExp(`^${options.arch}--[0-9]+$`).test(fs.readFileSync(file, 'utf8'))
      }
      return execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim() === expected
    })
  } catch {
    return false
  }
}

async function cachedNativeBuild(options, build) {
  const start = performance.now()
  const task = nativeTask(options)
  let result = 'failed'
  try {
    if (task && restoreTask(task) && validArchitecture(options)) {
      result = 'hit'
      return
    }
    if (task)
      for (const output of options.outputs) fs.rmSync(path.join(options.root, output), { recursive: true, force: true })
    await build()
    if (task && !validArchitecture(options))
      throw new Error(`Wrong native architecture for ${options.name}:${options.arch}`)
    result = task ? 'miss' : 'bypass'
    if (task) {
      try {
        saveTask(task)
      } catch {
        process.stderr.write(`Could not save ${options.name} native cache\n`)
      }
    }
  } finally {
    recordTiming(options.root, `${options.name}:${options.platform}:${options.arch}`, start, result, task?.key)
  }
}

function selectionPanelOptions(root, platform, arch) {
  return {
    root,
    name: 'selection-panel',
    platform,
    arch,
    electronVersion: 'N-API-8',
    inputs: ['native/darwin', path.relative(root, require('node-api-headers').include_dir)],
    outputs: [`resources/binaries/${platform}-${arch}/selection-panel.node`]
  }
}

module.exports = { cachedNativeBuild, selectionPanelOptions, nativeTask }
