import type { SpanContext } from '@opentelemetry/api'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  AddMemoryOptions,
  AssistantMessage,
  KnowledgeBaseParams,
  KnowledgeItem,
  KnowledgeSearchResult,
  MemoryConfig,
  MemoryListOptions,
  MemorySearchOptions
} from '@types'
import { ipcRenderer } from 'electron'

import { tracedInvoke } from './shared'

export const knowledgeApi = {
  knowledgeBase: {
    create: (base: KnowledgeBaseParams, context?: SpanContext) =>
      tracedInvoke(IpcChannel.KnowledgeBase_Create, context, base),
    reset: (base: KnowledgeBaseParams) => ipcRenderer.invoke(IpcChannel.KnowledgeBase_Reset, base),
    delete: (id: string) => ipcRenderer.invoke(IpcChannel.KnowledgeBase_Delete, id),
    add: ({
      base,
      item,
      userId,
      forceReload = false
    }: {
      base: KnowledgeBaseParams
      item: KnowledgeItem
      userId?: string
      forceReload?: boolean
    }) =>
      ipcRenderer.invoke(IpcChannel.KnowledgeBase_Add, {
        base,
        item,
        forceReload,
        userId
      }),
    remove: ({ uniqueId, uniqueIds, base }: { uniqueId: string; uniqueIds: string[]; base: KnowledgeBaseParams }) =>
      ipcRenderer.invoke(IpcChannel.KnowledgeBase_Remove, {
        uniqueId,
        uniqueIds,
        base
      }),
    search: ({ search, base }: { search: string; base: KnowledgeBaseParams }, context?: SpanContext) =>
      tracedInvoke(IpcChannel.KnowledgeBase_Search, context, { search, base }),
    rerank: (
      {
        search,
        base,
        results
      }: {
        search: string
        base: KnowledgeBaseParams
        results: KnowledgeSearchResult[]
      },
      context?: SpanContext
    ) =>
      tracedInvoke(IpcChannel.KnowledgeBase_Rerank, context, {
        search,
        base,
        results
      })
  },
  memory: {
    add: (messages: string | AssistantMessage[], options?: AddMemoryOptions) =>
      ipcRenderer.invoke(IpcChannel.Memory_Add, messages, options),
    search: (query: string, options: MemorySearchOptions) =>
      ipcRenderer.invoke(IpcChannel.Memory_Search, query, options),
    list: (options?: MemoryListOptions) => ipcRenderer.invoke(IpcChannel.Memory_List, options),
    delete: (id: string) => ipcRenderer.invoke(IpcChannel.Memory_Delete, id),
    update: (id: string, memory: string, metadata?: Record<string, any>) =>
      ipcRenderer.invoke(IpcChannel.Memory_Update, id, memory, metadata),
    get: (id: string) => ipcRenderer.invoke(IpcChannel.Memory_Get, id),
    setConfig: (config: MemoryConfig) => ipcRenderer.invoke(IpcChannel.Memory_SetConfig, config),
    deleteUser: (userId: string) => ipcRenderer.invoke(IpcChannel.Memory_DeleteUser, userId),
    deleteAllMemoriesForUser: (userId: string) =>
      ipcRenderer.invoke(IpcChannel.Memory_DeleteAllMemoriesForUser, userId),
    getUsersList: () => ipcRenderer.invoke(IpcChannel.Memory_GetUsersList),
    migrateMemoryDb: () => ipcRenderer.invoke(IpcChannel.Memory_MigrateMemoryDb)
  }
}
