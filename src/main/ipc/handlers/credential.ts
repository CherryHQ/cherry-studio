import { eq, sql } from 'drizzle-orm'

import { application } from '@application'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
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
    credentialCommand(() => application.get('CredentialStoreService').replaceApplication(input)),
  'credential.remove': async ({ id }) =>
    credentialCommand(() => application.get('CredentialStoreService').remove(id, isCredentialReferenced))
}

function isCredentialReferenced(id: string): boolean {
  const db = application.get('DbService').getDb()
  const channel = db
    .select({ id: agentChannelTable.id })
    .from(agentChannelTable)
    .where(sql`json_extract(${agentChannelTable.config}, '$.applicationCredentialId') = ${id}`)
    .get()
  const connection = db
    .select({ id: externalKnowledgeConnectionTable.id })
    .from(externalKnowledgeConnectionTable)
    .where(eq(externalKnowledgeConnectionTable.credentialReference, id))
    .get()
  return Boolean(channel || connection)
}
