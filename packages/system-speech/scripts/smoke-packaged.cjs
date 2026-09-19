const { spawnSync } = require('node:child_process')
const { statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const args = process.argv.slice(2).filter((arg) => arg !== '--')
if (args.length !== 1) throw new Error('Expected one packaged Cherry Studio .app')
const appPath = resolve(args[0])
const helperPath = join(appPath, 'Contents', 'Resources', 'system-speech', 'cherry-system-speech')
const helper = statSync(helperPath)
if (!helper.isFile() || (helper.mode & 0o100) === 0) throw new Error('Packaged helper is not executable')

for (const signatureArgs of [
  ['--verify', '--deep', '--strict', appPath],
  ['--verify', '--strict', helperPath]
]) {
  const result = spawnSync('/usr/bin/codesign', signatureArgs, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Packaged code signature verification failed')
}

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
process.stdout.write(`${JSON.stringify({ executable: true, signatureVerified: true, capabilities: true })}\n`)
