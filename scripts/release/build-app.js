const { execFileSync } = require('node:child_process')
const { createHmac } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createTask, restoreTask, saveTask, recordTiming } = require('./build-cache')
const { encryptionKey, restoreEncryptedTask, saveEncryptedTask } = require('./encrypted-build-cache')
const {
  compilationEnvironment,
  validateSentryUpload,
  injectSentryDebugIds,
  uploadSentryMaps
} = require('./sentry-artifacts')

const targets = ['main', 'preload', 'renderer', 'utility-process']

function buildInputs(root, target) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
    .split('\0')
    .filter(Boolean)
  const sources = files.filter((file) => {
    if (/^(docs|\.agents|\.claude|\.github|\.changeset)\//.test(file) || /(^|\/)README[^/]*\.md$/.test(file))
      return false
    if (file === 'AGENTS.md') return false
    if (file === 'resources/cherry-studio/release-history.json' || file === 'electron-builder.yml') return false
    if (file.startsWith('src/renderer/')) return target === 'renderer'
    if (file.startsWith('src/preload/')) return target === 'preload'
    if (file.startsWith('src/main/')) return target === 'main' || target === 'utility-process'
    return true
  })
  return [
    ...sources,
    'packages/ai-sdk-provider/dist',
    'packages/remote-protocol/dist',
    'packages/remote-transport/dist'
  ]
}

function cacheBypassReason(root, env) {
  if (env.CHERRY_BUILD_CACHE !== '1') return 'disabled'
  if (Object.keys(env).some((key) => key.startsWith('VISUALIZER_') && env[key])) return 'visualizer'
  if (encryptionKey(env)) return null
  if (env.SENTRY_SOURCE_MAP_UPLOAD === 'true') return 'encryption-key-required'
  if (Object.keys(env).some((key) => /(^|_)VITE_/.test(key) && env[key])) return 'encryption-key-required'
  if (fs.readdirSync(root).some((name) => /^\.env($|\.)/.test(name) && !name.endsWith('.example'))) return 'dotenv'
  return null
}

function taskEnvironment(root, target, env) {
  const prefix = target === 'utility-process' ? 'MAIN' : target.toUpperCase()
  const prefixes = ['VITE_', `${prefix}_VITE_`]
  // Vite expands dotenv against process.env; resolve with the compiler's credential-free environment.
  const script = `const { loadEnv } = require(${JSON.stringify(require.resolve('vite'))});
    process.stdout.write(JSON.stringify(loadEnv('production', process.argv[1], JSON.parse(process.argv[2]))))`
  const values = JSON.parse(
    execFileSync(process.execPath, ['-e', script, root, JSON.stringify(prefixes)], {
      env: { ...compilationEnvironment(env), NODE_ENV: 'production', DEBUG: '' },
      encoding: 'utf8'
    })
  )
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))
}

function javascriptTask(root, target, env = process.env) {
  if (!targets.includes(target)) throw new Error(`Unknown build target: ${target}`)
  const key = encryptionKey(env)
  const values = taskEnvironment(root, target, env)
  if (!key && (Object.keys(values).length || env.SENTRY_SOURCE_MAP_UPLOAD === 'true')) {
    throw new Error('Injected build configuration requires encrypted caching')
  }
  const task = createTask({
    root,
    name: target,
    inputs: buildInputs(root, target),
    outputs: [`out/${target}`],
    cacheRoot: path.join(root, key ? '.cache/release-build-encrypted' : '.cache/release-build'),
    identity: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      edition: env.CHERRY_EDITION || 'global',
      environment: key ? createHmac('sha256', key).update(JSON.stringify(values)).digest('hex') : null,
      sentry: env.SENTRY_SOURCE_MAP_UPLOAD === 'true',
      mode: 'production'
    }
  })
  return { ...task, encrypted: Boolean(key) }
}

function hasDeclaredInputs(root, target) {
  try {
    const declared = new Set(buildInputs(root, target))
    const observed = JSON.parse(fs.readFileSync(path.join(root, 'out', target, '.build-inputs.json'), 'utf8'))
    return (
      Array.isArray(observed) &&
      observed.length > 0 &&
      observed.every((input) => [...declared].some((file) => input === file || input.startsWith(`${file}/`)))
    )
  } catch {
    return false
  }
}

function runPnpm(root, args, env = process.env) {
  if (!env.npm_execpath) throw new Error('Run release builds through pnpm run')
  const script = /\.[cm]?js$/.test(env.npm_execpath)
  execFileSync(script ? process.execPath : env.npm_execpath, script ? [env.npm_execpath, ...args] : args, {
    cwd: root,
    stdio: 'inherit',
    env
  })
}

function timed(root, stage, run) {
  const start = performance.now()
  let result = 'failed'
  try {
    const value = run()
    result = 'built'
    return value
  } finally {
    recordTiming(root, stage, start, result)
  }
}

async function buildApplication(root, env = process.env) {
  validateSentryUpload(env)
  const buildEnv = { ...env, NODE_ENV: 'production', CHERRY_SENTRY_DEFER_UPLOAD: '1' }
  const compileEnv = compilationEnvironment(buildEnv)
  timed(root, 'prepare-packages', () =>
    runPnpm(root, ['--filter', '@cherrystudio/ai-sdk-provider', 'build'], compileEnv)
  )
  timed(root, 'release-info', () =>
    runPnpm(root, ['exec', 'tsx', 'scripts/release/bundled-release-info.ts'], compileEnv)
  )
  timed(root, 'prepare-selection-panel', () => runPnpm(root, ['exec', 'node', 'native/darwin/build.js'], compileEnv))
  timed(root, 'prepare-external-app', () =>
    runPnpm(root, ['exec', 'node', 'native/external-app/build.cjs'], compileEnv)
  )
  const bypass = cacheBypassReason(root, buildEnv)
  const key = encryptionKey(buildEnv)
  for (const target of targets) {
    const start = performance.now()
    let task
    let result = 'failed'
    try {
      if (!bypass) {
        try {
          task = javascriptTask(root, target, buildEnv)
        } catch {
          result = 'bypass:unhashable-input'
        }
      }
      if (task && (task.encrypted ? await restoreEncryptedTask(task, key) : restoreTask(task))) {
        result = 'hit'
        continue
      }
      fs.rmSync(path.join(root, 'out', target), { recursive: true, force: true })
      const args = ['exec', 'electron-vite', 'build']
      if (target === 'utility-process') args.push('--config', 'electron.vite.entries.config.ts')
      runPnpm(root, args, { ...compileEnv, CHERRY_BUILD_TARGET: target === 'utility-process' ? '' : target })
      if (buildEnv.SENTRY_SOURCE_MAP_UPLOAD === 'true') {
        injectSentryDebugIds(root, target, compileEnv)
      }
      result = bypass ? `bypass:${bypass}` : task ? 'miss' : 'bypass:unhashable-input'
      if (task && !hasDeclaredInputs(root, target)) result = 'bypass:undeclared-input'
      if (task && result === 'miss') {
        try {
          if (javascriptTask(root, target, buildEnv).key !== task.key) {
            throw new Error('Build inputs changed during compilation')
          }
          if (task.encrypted) await saveEncryptedTask(task, key)
          else saveTask(task)
        } catch {
          process.stderr.write(`Could not save ${target} cache; build output retained\n`)
        }
      }
    } finally {
      recordTiming(root, target, start, result, task?.key)
      process.stdout.write(`[release-build] ${target}: ${result}\n`)
    }
  }
  if (buildEnv.SENTRY_SOURCE_MAP_UPLOAD === 'true') {
    timed(root, 'sentry-upload', () => uploadSentryMaps(root, targets, buildEnv))
  }
}

async function main(args) {
  const root = process.cwd()
  const platform = args[0]
  if (platform && !['linux', 'mac', 'win'].includes(platform)) throw new Error('Expected linux, mac or win')
  const edition = process.env.CHERRY_EDITION || 'global'
  if (!['global', 'cn'].includes(edition)) throw new Error('Expected global or cn edition')
  await buildApplication(root)
  if (platform) {
    const builderArgs = ['exec', 'electron-builder', `--${platform}`, '--x64', '--arm64']
    if (edition === 'cn') builderArgs.push('--config', 'electron-builder.cn.config.cjs')
    timed(root, 'package-sign', () => runPnpm(root, builderArgs, compilationEnvironment(process.env)))
  }
}

module.exports = {
  buildInputs,
  cacheBypassReason,
  javascriptTask,
  hasDeclaredInputs,
  buildApplication,
  taskEnvironment
}
if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Release build failed: ${error.message.split('\n')[0]}\n`)
    process.exitCode = 1
  })
}
