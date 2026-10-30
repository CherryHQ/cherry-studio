const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { createTask, restoreTask, saveTask, recordTiming } = require('./build-cache')

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
  if (env.SENTRY_SOURCE_MAP_UPLOAD === 'true') return 'sentry-upload'
  if (Object.keys(env).some((key) => /(^|_)VITE_|^VISUALIZER_/.test(key) && env[key])) return 'build-environment'
  if (fs.readdirSync(root).some((name) => /^\.env($|\.)/.test(name) && !name.endsWith('.example'))) return 'dotenv'
  return null
}

function javascriptTask(root, target, env = process.env) {
  if (!targets.includes(target)) throw new Error(`Unknown build target: ${target}`)
  return createTask({
    root,
    name: target,
    inputs: buildInputs(root, target),
    outputs: [`out/${target}`],
    identity: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      edition: env.CHERRY_EDITION || 'global',
      mode: 'production',
      image: env.ImageVersion || null
    }
  })
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

function buildApplication(root, env = process.env) {
  const buildEnv = { ...env, NODE_ENV: 'production' }
  timed(root, 'prepare-packages', () => runPnpm(root, ['--filter', '@cherrystudio/ai-sdk-provider', 'build'], buildEnv))
  timed(root, 'release-info', () => runPnpm(root, ['exec', 'tsx', 'scripts/release/bundled-release-info.ts'], buildEnv))
  const bypass = cacheBypassReason(root, buildEnv)
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
      if (task && restoreTask(task)) {
        result = 'hit'
        continue
      }
      fs.rmSync(path.join(root, 'out', target), { recursive: true, force: true })
      const args = ['exec', 'electron-vite', 'build']
      if (target === 'utility-process') args.push('--config', 'electron.vite.entries.config.ts')
      runPnpm(root, args, { ...buildEnv, CHERRY_BUILD_TARGET: target === 'utility-process' ? '' : target })
      result = bypass ? `bypass:${bypass}` : task ? 'miss' : 'bypass:unhashable-input'
      if (task && !hasDeclaredInputs(root, target)) result = 'bypass:undeclared-input'
      if (task && result === 'miss') {
        try {
          saveTask(task)
        } catch {
          process.stderr.write(`Could not save ${target} cache; build output retained\n`)
        }
      }
    } finally {
      recordTiming(root, target, start, result, task?.key)
      process.stdout.write(`[release-build] ${target}: ${result}\n`)
    }
  }
}

function main(args) {
  const root = process.cwd()
  const platform = args[0]
  if (platform && !['linux', 'mac', 'win'].includes(platform)) throw new Error('Expected linux, mac or win')
  const edition = process.env.CHERRY_EDITION || 'global'
  if (!['global', 'cn'].includes(edition)) throw new Error('Expected global or cn edition')
  buildApplication(root)
  if (platform) {
    const builderArgs = ['exec', 'electron-builder', `--${platform}`, '--x64', '--arm64']
    if (edition === 'cn') builderArgs.push('--config', 'electron-builder.cn.config.cjs')
    timed(root, 'package-sign', () => runPnpm(root, builderArgs))
  }
}

module.exports = { buildInputs, cacheBypassReason, javascriptTask, hasDeclaredInputs, buildApplication }
if (require.main === module) main(process.argv.slice(2))
