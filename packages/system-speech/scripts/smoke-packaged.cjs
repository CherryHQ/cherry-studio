const { spawnSync } = require('node:child_process')
const { statSync } = require('node:fs')
const { basename, join, resolve } = require('node:path')

const supportedArchitectures = new Set(['arm64', 'x86_64'])

function parseEntitlementKeys(output) {
  return [...output.matchAll(/<key>\s*([^<]+?)\s*<\/key>/g)].map((match) => match[1])
}

function assertAllowedEntitlements(entitlements, allowed = []) {
  const allowedEntitlements = new Set(allowed)
  const forbidden = entitlements.filter((entitlement) => !allowedEntitlements.has(entitlement))
  if (forbidden.length > 0) {
    throw new Error(`Packaged helper has forbidden entitlements: ${forbidden.join(', ')}`)
  }
}

function parseMachOArchitectures(output) {
  const architectures = [...new Set(output.trim().split(/\s+/).filter(Boolean))].sort()
  if (architectures.length === 0 || architectures.some((architecture) => !supportedArchitectures.has(architecture))) {
    throw new Error('Unable to read Mach-O architectures')
  }
  return architectures
}

function assertMatchingArchitectures(helperArchitectures, appArchitectures) {
  const helper = [...helperArchitectures].sort()
  const app = [...appArchitectures].sort()
  if (helper.join(',') !== app.join(',')) {
    throw new Error(
      `Packaged helper architectures ${helper.join(', ')} do not match app architectures ${app.join(', ')}`
    )
  }
}

function run(command, args, errorMessage) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(errorMessage)
  return result
}

function main(argv = process.argv.slice(2)) {
  const args = argv.filter((arg) => arg !== '--')
  if (args.length !== 1) throw new Error('Expected one packaged Cherry Studio .app')
  const appPath = resolve(args[0])
  const helperPath = join(appPath, 'Contents', 'Resources', 'system-speech', 'cherry-system-speech')
  const helper = statSync(helperPath)
  if (!helper.isFile() || (helper.mode & 0o100) === 0) throw new Error('Packaged helper is not executable')

  for (const signatureArgs of [
    ['--verify', '--deep', '--strict', appPath],
    ['--verify', '--strict', helperPath]
  ]) {
    run('/usr/bin/codesign', signatureArgs, 'Packaged code signature verification failed')
  }

  const entitlementsResult = run(
    '/usr/bin/codesign',
    ['--display', '--entitlements', '-', '--xml', helperPath],
    'Unable to inspect packaged helper entitlements'
  )
  const entitlements = parseEntitlementKeys(`${entitlementsResult.stdout}\n${entitlementsResult.stderr}`)
  assertAllowedEntitlements(entitlements)

  const infoPlist = join(appPath, 'Contents', 'Info.plist')
  const executableResult = run(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', infoPlist],
    'Unable to read packaged app executable'
  )
  const executableName = executableResult.stdout.trim()
  if (!executableName || basename(executableName) !== executableName) {
    throw new Error('Invalid packaged app executable')
  }
  const appExecutablePath = join(appPath, 'Contents', 'MacOS', executableName)
  const helperArchitectures = parseMachOArchitectures(
    run('/usr/bin/lipo', ['-archs', helperPath], 'Unable to inspect packaged helper architectures').stdout
  )
  const appArchitectures = parseMachOArchitectures(
    run('/usr/bin/lipo', ['-archs', appExecutablePath], 'Unable to inspect packaged app architectures').stdout
  )
  assertMatchingArchitectures(helperArchitectures, appArchitectures)

  const result = spawnSync(helperPath, [], {
    encoding: 'utf8',
    input: `${JSON.stringify({ operation: 'capabilities', locale: 'en-US' })}\n`,
    maxBuffer: 1024 * 1024,
    timeout: 30_000
  })
  if (result.status !== 0) throw new Error('Packaged helper failed')
  const response = JSON.parse(result.stdout)
  if (
    response.ok !== true ||
    response.value?.operation !== 'capabilities' ||
    !Array.isArray(response.value.result?.voices)
  ) {
    throw new Error('Invalid packaged helper capabilities response')
  }
  process.stdout.write(
    `${JSON.stringify({
      executable: true,
      signatureVerified: true,
      entitlements,
      architectures: helperArchitectures,
      capabilities: true
    })}\n`
  )
}

exports.assertAllowedEntitlements = assertAllowedEntitlements
exports.assertMatchingArchitectures = assertMatchingArchitectures
exports.main = main
exports.parseEntitlementKeys = parseEntitlementKeys
exports.parseMachOArchitectures = parseMachOArchitectures

if (require.main === module) main()
