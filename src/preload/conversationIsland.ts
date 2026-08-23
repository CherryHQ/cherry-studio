import type {
  UnifiedPreferenceKeyType,
  UnifiedPreferenceMultipleResultType,
  UnifiedPreferenceType
} from '@shared/data/preference/preferenceTypes'
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// Keep this sandboxed preload self-contained: a runtime value import creates a
// chunk that Electron's sandboxed preload loader cannot require.
const preferenceChannels = {
  changed: 'preference:changed',
  get: 'preference:get',
  getMultipleRaw: 'preference:get-multiple-raw',
  set: 'preference:set',
  subscribe: 'preference:subscribe'
} as const

const readablePreferenceKeys = new Set<UnifiedPreferenceKeyType>([
  'app.language',
  'ui.custom_css',
  'ui.theme_mode',
  'ui.theme_user.color_primary',
  'ui.theme_user.font_family',
  'ui.theme_user.code_font_family'
])

function assertReadablePreference(key: UnifiedPreferenceKeyType): void {
  if (!readablePreferenceKeys.has(key)) {
    throw new Error('Preference is not available to Conversation Island')
  }
}

const ipcApi = {
  request: (route: string, input?: unknown, meta?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('ipc-api:request', route, input, meta),
  on: (event: string, callback: (payload: unknown) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) callback(payload)
    }
    ipcRenderer.on('ipc-api:event', listener)
    return () => ipcRenderer.removeListener('ipc-api:event', listener)
  }
}

const electron = {
  process: {
    platform: process.platform,
    env: { NODE_ENV: process.env.NODE_ENV }
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
      if (channel !== 'app:log-to-main') {
        throw new Error('IPC channel is not available to Conversation Island')
      }
      return ipcRenderer.invoke(channel, ...args)
    }
  }
}

const preference = {
  get: async <K extends UnifiedPreferenceKeyType>(key: K): Promise<UnifiedPreferenceType[K]> => {
    assertReadablePreference(key)
    return ipcRenderer.invoke(preferenceChannels.get, key)
  },
  set: async <K extends UnifiedPreferenceKeyType>(key: K, value: UnifiedPreferenceType[K]): Promise<void> => {
    if (key !== 'ui.theme_mode') {
      throw new Error('Preference is not available to Conversation Island')
    }
    return ipcRenderer.invoke(preferenceChannels.set, key, value)
  },
  getMultipleRaw: async <K extends UnifiedPreferenceKeyType>(
    keys: K[]
  ): Promise<UnifiedPreferenceMultipleResultType<K>> => {
    keys.forEach(assertReadablePreference)
    return ipcRenderer.invoke(preferenceChannels.getMultipleRaw, keys)
  },
  subscribe: async (keys: UnifiedPreferenceKeyType[]): Promise<void> => {
    keys.forEach(assertReadablePreference)
    return ipcRenderer.invoke(preferenceChannels.subscribe, keys)
  },
  onChanged: (callback: (key: UnifiedPreferenceKeyType, value: unknown) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, key: UnifiedPreferenceKeyType, value: unknown) => {
      if (readablePreferenceKeys.has(key)) callback(key, value)
    }
    ipcRenderer.on(preferenceChannels.changed, listener)
    return () => ipcRenderer.off(preferenceChannels.changed, listener)
  }
}

contextBridge.exposeInMainWorld('electron', electron)
contextBridge.exposeInMainWorld('api', { ipcApi, preference })
