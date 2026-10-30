const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const SentryCli = require('@sentry/cli')

function compilationEnvironment(env) {
  const compilation = { ...env }
  for (const key of ['CHERRY_BUILD_CACHE_KEY', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'])
    delete compilation[key]
  return compilation
}

function validateSentryUpload(env) {
  if (env.SENTRY_SOURCE_MAP_UPLOAD !== 'true') return
  const missing = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].filter((key) => !env[key]?.trim())
  if (missing.length) throw new Error(`Sentry production builds require: ${missing.join(', ')}`)
}

function injectSentryDebugIds(root, target, env) {
  execFileSync(SentryCli.getPath(), ['sourcemaps', 'inject', path.join(root, 'out', target)], {
    cwd: root,
    env: compilationEnvironment(env),
    stdio: 'inherit'
  })
}

function validateSentryArtifacts(directory) {
  const maps = fs.readdirSync(directory, { recursive: true }).filter((file) => /\.[cm]?js\.map$/.test(file))
  if (!maps.length) throw new Error('Sentry upload requires JavaScript source maps for every build task')
  for (const file of maps) {
    const map = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
    const debugId = map.debug_id || map.debugId
    const javascript = fs.readFileSync(path.join(directory, file.slice(0, -4)), 'utf8')
    if (!debugId || !javascript.includes(`//# debugId=${debugId}`)) {
      throw new Error('Sentry source map does not match the JavaScript Debug ID')
    }
  }
}

function uploadSentryMaps(root, targets, env) {
  validateSentryUpload(env)
  const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const directories = targets.map((target) => path.join(root, 'out', target))
  directories.forEach(validateSentryArtifacts)
  const uploadEnv = { ...env }
  delete uploadEnv.CHERRY_BUILD_CACHE_KEY
  execFileSync(
    SentryCli.getPath(),
    ['sourcemaps', 'upload', '--release', `${name}@${version}`, '--validate', '--strict', '--wait', ...directories],
    { cwd: root, env: { ...uploadEnv, SENTRY_ALLOW_FAILURE: 'false' }, stdio: 'inherit' }
  )
  for (const directory of directories) {
    for (const file of fs.readdirSync(directory, { recursive: true })) {
      if (file.endsWith('.map')) fs.rmSync(path.join(directory, file))
    }
  }
}

module.exports = { compilationEnvironment, validateSentryUpload, injectSentryDebugIds, uploadSentryMaps }
