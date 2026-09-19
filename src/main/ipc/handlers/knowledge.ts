import { application } from '@application'
import { ExternalKnowledgeRuntimeError } from '@main/features/knowledge'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'
import type { knowledgeRequestSchemas } from '@shared/ipc/schemas/knowledge'
import type { IpcHandlersFor } from '@shared/ipc/types'

function mapExternalKnowledgeError(error: unknown, fallback: { code: string; message: string }): IpcError {
  if (error instanceof ExternalKnowledgeRuntimeError) {
    switch (error.code) {
      case 'not-found':
        return new IpcError(
          knowledgeErrorCodes.EXTERNAL_CONNECTION_NOT_FOUND,
          'External Knowledge connection not found'
        )
      case 'scope-missing':
        return new IpcError(knowledgeErrorCodes.FEISHU_SCOPE_MISSING, 'Required Feishu permissions were not granted')
      case 'automatic-scope-mismatch':
        return new IpcError(
          knowledgeErrorCodes.FEISHU_AUTOMATIC_SCOPE_MISMATCH,
          'The automatically registered Feishu application granted unexpected permissions'
        )
      case 'identity-conflict':
        return new IpcError(
          knowledgeErrorCodes.FEISHU_IDENTITY_CONFLICT,
          'The Feishu account does not match this connection'
        )
      case 'identity-unverifiable':
        return new IpcError(
          knowledgeErrorCodes.FEISHU_IDENTITY_UNVERIFIABLE,
          'The Feishu account identity could not be verified'
        )
      case 'credential-unavailable':
        return new IpcError(
          knowledgeErrorCodes.EXTERNAL_CREDENTIAL_UNAVAILABLE,
          'External Knowledge credentials are unavailable'
        )
      case 'reauthorization-required':
        return new IpcError(
          knowledgeErrorCodes.EXTERNAL_REAUTHORIZATION_REQUIRED,
          'The Feishu connection requires authorization'
        )
      case 'stopped':
        return new IpcError(knowledgeErrorCodes.EXTERNAL_RUNTIME_STOPPED, 'External Knowledge is unavailable')
      case 'session-not-found':
      case 'authorization-failed':
        return new IpcError(knowledgeErrorCodes.FEISHU_AUTHORIZATION_FAILED, 'Feishu authorization failed')
    }
  }
  return new IpcError(fallback.code, fallback.message)
}

async function externalKnowledgeCommand<T>(
  operation: () => Promise<T>,
  fallback: { code: string; message: string } = {
    code: knowledgeErrorCodes.FEISHU_AUTHORIZATION_FAILED,
    message: 'Feishu authorization failed'
  }
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw mapExternalKnowledgeError(error, fallback)
  }
}

/**
 * Thin adapters for the knowledge request routes: each one translates a parsed route
 * call into a `KnowledgeService` method (business logic + resource lifecycle stay in
 * that service). These routes act on shared business data, not the caller's window, so
 * they ignore `IpcContext` — there is no `senderId` addressing here (contrast window.ts).
 *
 * Void-output routes use a block body so the arrow resolves `undefined`, matching the
 * route's `z.void()` output (see selection.ts hide_toolbar).
 */
export const knowledgeHandlers: IpcHandlersFor<typeof knowledgeRequestSchemas> = {
  'knowledge.feishu.registration.begin': async () =>
    externalKnowledgeCommand(() => application.get('KnowledgeService').beginFeishuAppRegistration(), {
      code: knowledgeErrorCodes.FEISHU_REGISTRATION_FAILED,
      message: 'Feishu application registration failed'
    }),
  'knowledge.feishu.registration.cancel': async ({ registrationSessionId }) => {
    await externalKnowledgeCommand(
      () => application.get('KnowledgeService').cancelFeishuAppRegistration(registrationSessionId),
      {
        code: knowledgeErrorCodes.FEISHU_REGISTRATION_FAILED,
        message: 'Feishu application registration failed'
      }
    )
  },
  'knowledge.feishu.authorization.begin': async (input) =>
    externalKnowledgeCommand(() => application.get('KnowledgeService').beginFeishuUserAuthorization(input)),
  'knowledge.feishu.authorization.complete': async ({ authorizationSessionId }) =>
    externalKnowledgeCommand(() =>
      application.get('KnowledgeService').completeFeishuUserAuthorization(authorizationSessionId)
    ),
  'knowledge.feishu.authorization.cancel': async ({ authorizationSessionId }) => {
    await externalKnowledgeCommand(() =>
      application.get('KnowledgeService').cancelFeishuUserAuthorization(authorizationSessionId)
    )
  },
  'knowledge.feishu.connection.reconnect': async ({ connectionId, credentials }) =>
    externalKnowledgeCommand(() =>
      application.get('KnowledgeService').reconnectFeishuConnection(connectionId, credentials)
    ),
  'knowledge.feishu.connection.validate': async ({ connectionId }) =>
    externalKnowledgeCommand(() => application.get('KnowledgeService').validateFeishuConnection(connectionId)),
  'knowledge.feishu.connection.remove': async ({ connectionId }) => {
    await externalKnowledgeCommand(() =>
      application.get('KnowledgeService').removeExternalKnowledgeConnection(connectionId)
    )
  },
  'knowledge.create_base': async ({ base }) => application.get('KnowledgeService').createBase(base),
  'knowledge.restore_base': async (dto) => application.get('KnowledgeService').restoreBase(dto),
  'knowledge.delete_base': async ({ baseId }) => {
    await application.get('KnowledgeService').deleteBase(baseId)
  },
  'knowledge.add_items': async ({ baseId, items, conflictStrategy }) =>
    application.get('KnowledgeService').addItems(baseId, items, conflictStrategy),
  'knowledge.delete_items': async ({ baseId, itemIds }) => {
    await application.get('KnowledgeService').deleteItems(baseId, itemIds)
  },
  'knowledge.reindex_items': async ({ baseId, itemIds }) => {
    await application.get('KnowledgeService').reindexItems(baseId, itemIds)
  },
  'knowledge.enable_embedding_model': async ({ baseId, patch }) =>
    application.get('KnowledgeService').enableEmbeddingModel(baseId, patch),
  'knowledge.search': async ({ baseId, query }) => application.get('KnowledgeService').search(baseId, query),
  'knowledge.get_file_path': async ({ itemId }) => {
    try {
      return application.get('KnowledgeService').getFilePath(itemId)
    } catch (error) {
      if (isDataApiError(error) && (error.code === ErrorCode.NOT_FOUND || error.code === ErrorCode.INVALID_OPERATION)) {
        throw new IpcError(knowledgeErrorCodes.SOURCE_PATH_UNAVAILABLE, 'Knowledge source path is unavailable', {
          cause: error.code
        })
      }
      throw error
    }
  },
  'knowledge.list_item_chunks': async ({ baseId, itemId }) =>
    application.get('KnowledgeService').listItemChunks(baseId, itemId)
}
