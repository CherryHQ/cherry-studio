import { application } from '@application'
import { CredentialStoreError, type CredentialStoreErrorCode } from '@main/services/credential'
import { credentialErrorCodes } from '@shared/ipc/errors/credential'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { credentialRequestSchemas } from '@shared/ipc/schemas/credential'
import type { IpcHandlersFor } from '@shared/ipc/types'

const errorCodes = {
  invalid: credentialErrorCodes.INVALID,
  missing: credentialErrorCodes.MISSING,
  corrupt: credentialErrorCodes.CORRUPT,
  unreadable: credentialErrorCodes.UNREADABLE,
  'write-failed': credentialErrorCodes.WRITE_FAILED,
  conflict: credentialErrorCodes.CONFLICT,
  'in-use': credentialErrorCodes.IN_USE,
  stopped: credentialErrorCodes.STOPPED
} satisfies Record<CredentialStoreErrorCode, string>

async function credentialCommand<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw new IpcError(
      error instanceof CredentialStoreError ? errorCodes[error.code] : credentialErrorCodes.UNAVAILABLE
    )
  }
}

export const credentialHandlers: IpcHandlersFor<typeof credentialRequestSchemas> = {
  'credential.list': async (filter) =>
    credentialCommand(() => application.get('CredentialStoreService').listSummaries(filter)),
  'credential.feishu.create_application': async ({ label, ...payload }) =>
    credentialCommand(() =>
      application.get('CredentialStoreService').create({ connector: 'feishu', kind: 'application', label, payload })
    ),
  'credential.feishu.replace_application': async (input) =>
    credentialCommand(() => application.get('CredentialStoreService').replaceApplication(input))
}
