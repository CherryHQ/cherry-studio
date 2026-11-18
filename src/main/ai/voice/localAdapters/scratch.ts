import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

import { checkAbort, VoiceCleanupError, type VoiceRuntimeError } from '../VoiceRuntimeError'

const logger = loggerService.withContext('VoiceScratch')

export async function withScratch<T>(
  operation: (directory: string) => Promise<T>,
  signal: AbortSignal | undefined,
  mapFailure: (error: unknown, signal?: AbortSignal) => VoiceRuntimeError
): Promise<T> {
  checkAbort(signal)
  const directory = join(application.getPath('feature.voice.temp'), randomUUID())
  let result!: T
  let failure: VoiceRuntimeError | undefined
  try {
    await mkdir(directory, { mode: 0o700 })
    checkAbort(signal)
    result = await operation(directory)
  } catch (error) {
    failure = mapFailure(error, signal)
  }
  try {
    await rm(directory, { recursive: true, force: true })
  } catch {
    logger.warn('Voice scratch cleanup failed')
    failure = new VoiceCleanupError(failure?.reason)
  }
  if (failure) throw failure
  return result
}
