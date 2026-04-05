import type { TokenUsageData } from '@cherrystudio/analytics-client'
import type { SpanEntity, TokenUsage } from '@mcp-trace/trace-core'
import type { CacheEntry, CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import type {
  UnifiedPreferenceKeyType,
  UnifiedPreferenceMultipleResultType,
  UnifiedPreferenceType
} from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  GetApiServerStatusResult,
  RestartApiServerStatusResult,
  StartApiServerStatusResult,
  StopApiServerStatusResult
} from '@types'
import { ipcRenderer } from 'electron'

export const dataApi = {
  // CacheService related APIs
  cache: {
    // Broadcast sync message to other windows
    broadcastSync: (message: CacheSyncMessage): void => ipcRenderer.send(IpcChannel.Cache_Sync, message),

    // Listen for sync messages from other windows
    onSync: (callback: (message: CacheSyncMessage) => void) => {
      const listener = (_: any, message: CacheSyncMessage) => callback(message)
      ipcRenderer.on(IpcChannel.Cache_Sync, listener)
      return () => ipcRenderer.off(IpcChannel.Cache_Sync, listener)
    },

    // Get all shared cache entries from Main for initialization sync
    getAllShared: (): Promise<Record<string, CacheEntry>> => ipcRenderer.invoke(IpcChannel.Cache_GetAllShared)
  },

  // PreferenceService related APIs
  // DO NOT MODIFY THIS SECTION
  preference: {
    get: <K extends UnifiedPreferenceKeyType>(key: K): Promise<UnifiedPreferenceType[K]> =>
      ipcRenderer.invoke(IpcChannel.Preference_Get, key),
    set: <K extends UnifiedPreferenceKeyType>(key: K, value: UnifiedPreferenceType[K]): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.Preference_Set, key, value),
    getMultipleRaw: <K extends UnifiedPreferenceKeyType>(keys: K[]): Promise<UnifiedPreferenceMultipleResultType<K>> =>
      ipcRenderer.invoke(IpcChannel.Preference_GetMultipleRaw, keys),
    setMultiple: (updates: Partial<UnifiedPreferenceType>) =>
      ipcRenderer.invoke(IpcChannel.Preference_SetMultiple, updates),
    getAll: (): Promise<UnifiedPreferenceType> => ipcRenderer.invoke(IpcChannel.Preference_GetAll),
    subscribe: (keys: UnifiedPreferenceKeyType[]) => ipcRenderer.invoke(IpcChannel.Preference_Subscribe, keys),
    onChanged: (callback: (key: UnifiedPreferenceKeyType, value: any) => void) => {
      const listener = (_: any, key: UnifiedPreferenceKeyType, value: any) => callback(key, value)
      ipcRenderer.on(IpcChannel.Preference_Changed, listener)
      return () => ipcRenderer.off(IpcChannel.Preference_Changed, listener)
    }
  },

  // Data API related APIs
  dataApi: {
    request: (req: any) => ipcRenderer.invoke(IpcChannel.DataApi_Request, req),
    subscribe: (path: string, callback: (data: any, event: string) => void) => {
      const channel = `${IpcChannel.DataApi_Stream}:${path}`
      const listener = (_: any, data: any, event: string) => callback(data, event)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.off(channel, listener)
    }
  },

  apiServer: {
    getStatus: (): Promise<GetApiServerStatusResult> => ipcRenderer.invoke(IpcChannel.ApiServer_GetStatus),
    start: (): Promise<StartApiServerStatusResult> => ipcRenderer.invoke(IpcChannel.ApiServer_Start),
    restart: (): Promise<RestartApiServerStatusResult> => ipcRenderer.invoke(IpcChannel.ApiServer_Restart),
    stop: (): Promise<StopApiServerStatusResult> => ipcRenderer.invoke(IpcChannel.ApiServer_Stop),
    onReady: (callback: () => void): (() => void) => {
      const listener = () => {
        callback()
      }
      ipcRenderer.on(IpcChannel.ApiServer_Ready, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannel.ApiServer_Ready, listener)
      }
    }
  },

  trace: {
    saveData: (topicId: string) => ipcRenderer.invoke(IpcChannel.TRACE_SAVE_DATA, topicId),
    getData: (topicId: string, traceId: string, modelName?: string) =>
      ipcRenderer.invoke(IpcChannel.TRACE_GET_DATA, topicId, traceId, modelName),
    saveEntity: (entity: SpanEntity) => ipcRenderer.invoke(IpcChannel.TRACE_SAVE_ENTITY, entity),
    getEntity: (spanId: string) => ipcRenderer.invoke(IpcChannel.TRACE_GET_ENTITY, spanId),
    bindTopic: (topicId: string, traceId: string) => ipcRenderer.invoke(IpcChannel.TRACE_BIND_TOPIC, topicId, traceId),
    tokenUsage: (spanId: string, usage: TokenUsage) => ipcRenderer.invoke(IpcChannel.TRACE_TOKEN_USAGE, spanId, usage),
    cleanHistory: (topicId: string, traceId: string, modelName?: string) =>
      ipcRenderer.invoke(IpcChannel.TRACE_CLEAN_HISTORY, topicId, traceId, modelName),
    cleanTopic: (topicId: string, traceId?: string) =>
      ipcRenderer.invoke(IpcChannel.TRACE_CLEAN_TOPIC, topicId, traceId),
    openWindow: (topicId: string, traceId: string, autoOpen?: boolean, modelName?: string) =>
      ipcRenderer.invoke(IpcChannel.TRACE_OPEN_WINDOW, topicId, traceId, autoOpen, modelName),
    setTraceWindowTitle: (title: string) => ipcRenderer.invoke(IpcChannel.TRACE_SET_TITLE, title),
    addEndMessage: (spanId: string, modelName: string, context: string) =>
      ipcRenderer.invoke(IpcChannel.TRACE_ADD_END_MESSAGE, spanId, modelName, context),
    cleanLocalData: () => ipcRenderer.invoke(IpcChannel.TRACE_CLEAN_LOCAL_DATA),
    addStreamMessage: (spanId: string, modelName: string, context: string, message: any) =>
      ipcRenderer.invoke(IpcChannel.TRACE_ADD_STREAM_MESSAGE, spanId, modelName, context, message)
  },

  analytics: {
    trackTokenUsage: (data: TokenUsageData) => ipcRenderer.invoke(IpcChannel.Analytics_TrackTokenUsage, data)
  }
}
