import { IpcError } from '@shared/ipc/errors/IpcError'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Dev-only IPC schemas. Routes here must refuse packaged builds in their
 * main handlers — renderer DEV visibility is UX only, not a security boundary.
 */
export const devRequestSchemas = {
  'dev.reset_app_data': defineRoute({
    input: z.void(),
    output: z.strictObject({
      ok: z.literal(true),
      /** Main owns relaunch after success; caller must not keep using this process. */
      restartRequired: z.literal(true)
    })
  })
}

export const DevResetErrorCode = {
  DEV_ONLY: 'DEV_ONLY',
  DEV_RESET_BUSY: 'DEV_RESET_BUSY',
  DEV_RESET_BACKUP_BUSY: 'DEV_RESET_BACKUP_BUSY',
  DEV_RESET_RESTORE_PENDING: 'DEV_RESET_RESTORE_PENDING',
  DEV_RESET_INCOMPLETE: 'DEV_RESET_INCOMPLETE',
  DEV_RESET_QUIESCE_FAILED: 'DEV_RESET_QUIESCE_FAILED'
} as const

export function devResetError(code: string, message?: string, data?: unknown): IpcError {
  return new IpcError(code, message ?? code, data)
}
