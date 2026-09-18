import { spawnSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { NativeResponse } from '../src/contracts'

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2).filter((argument) => argument !== '--')
  const appArgument = arguments_[0]
  if (!appArgument || arguments_.length !== 1) throw new Error('Expected one .app path')

  const appPath = resolve(appArgument)
  const helperPath = join(appPath, 'Contents', 'Resources', 'system-speech', 'cherry-system-speech')
  const helper = await stat(helperPath)
  if (!helper.isFile() || (helper.mode & 0o100) === 0) throw new Error('Packaged helper is not owner-executable')

  verifySignature(['--verify', '--deep', '--strict', appPath])
  verifySignature(['--verify', '--strict', helperPath])

  const capabilities = spawnSync(helperPath, [], {
    encoding: 'utf8',
    input: `${JSON.stringify({ operation: 'capabilities', locale: 'zh-CN' })}\n`,
    maxBuffer: 1024 * 1024
  })
  if (capabilities.status !== 0 || capabilities.error) throw new Error('Packaged helper failed')
  const response: unknown = JSON.parse(capabilities.stdout)
  if (!isCapabilitiesResponse(response)) throw new Error('Packaged helper returned an invalid response')

  process.stdout.write(`${JSON.stringify({ executable: true, signed: true, capabilities: true })}\n`)
}

function verifySignature(args: string[]): void {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' })
  if (result.status !== 0 || result.error) throw new Error('Code signature verification failed')
}

function isCapabilitiesResponse(value: unknown): value is NativeResponse {
  if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true || !('value' in value)) {
    return false
  }
  const success = value.value
  return Boolean(
    success && typeof success === 'object' && 'operation' in success && success.operation === 'capabilities'
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Packaged helper smoke test failed'}\n`)
  process.exitCode = 1
})
