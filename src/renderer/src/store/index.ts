import { loggerService } from '@logger'
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector, useStore } from 'react-redux'
import {
  createTransform,
  FLUSH,
  PAUSE,
  PERSIST,
  persistReducer,
  persistStore,
  PURGE,
  REGISTER,
  REHYDRATE
} from 'redux-persist'
import storage from 'redux-persist/lib/storage'

import storeSyncService from '../services/StoreSyncService'
import { decryptSecret, encryptSecret } from '../utils/secureStorage'
import assistants from './assistants'
import backup from './backup'
import codeTools from './codeTools'
import copilot from './copilot'
import inputToolsReducer from './inputTools'
import knowledge from './knowledge'
import llm from './llm'
import mcp from './mcp'
import memory from './memory'
import messageBlocksReducer from './messageBlock'
import migrate from './migrate'
import minapps from './minapps'
import newMessagesReducer from './newMessage'
import { setNotesPath } from './note'
import note from './note'
import nutstore from './nutstore'
import ocr from './ocr'
import paintings from './paintings'
import preprocess from './preprocess'
import runtime from './runtime'
import selectionStore from './selectionStore'
import settings from './settings'
import shortcuts from './shortcuts'
import tabs from './tabs'
import toolPermissions from './toolPermissions'
import translate from './translate'
import websearch from './websearch'

const logger = loggerService.withContext('Store')

const securePersistTransform = createTransform(
  (inboundState: any, key) => {
    if (!inboundState || typeof inboundState !== 'object') {
      return inboundState
    }

    if (key === 'llm') {
      return {
        ...inboundState,
        providers: Array.isArray(inboundState.providers)
          ? inboundState.providers.map((provider: any) => ({
              ...provider,
              apiKey: typeof provider.apiKey === 'string' ? encryptSecret(provider.apiKey) : provider.apiKey
            }))
          : inboundState.providers,
        settings: {
          ...inboundState.settings,
          vertexai: inboundState.settings?.vertexai
            ? {
                ...inboundState.settings.vertexai,
                serviceAccount: inboundState.settings.vertexai.serviceAccount
                  ? {
                      ...inboundState.settings.vertexai.serviceAccount,
                      privateKey:
                        typeof inboundState.settings.vertexai.serviceAccount.privateKey === 'string'
                          ? encryptSecret(inboundState.settings.vertexai.serviceAccount.privateKey)
                          : inboundState.settings.vertexai.serviceAccount.privateKey
                    }
                  : inboundState.settings.vertexai.serviceAccount
              }
            : inboundState.settings?.vertexai,
          awsBedrock: inboundState.settings?.awsBedrock
            ? {
                ...inboundState.settings.awsBedrock,
                accessKeyId:
                  typeof inboundState.settings.awsBedrock.accessKeyId === 'string'
                    ? encryptSecret(inboundState.settings.awsBedrock.accessKeyId)
                    : inboundState.settings.awsBedrock.accessKeyId,
                secretAccessKey:
                  typeof inboundState.settings.awsBedrock.secretAccessKey === 'string'
                    ? encryptSecret(inboundState.settings.awsBedrock.secretAccessKey)
                    : inboundState.settings.awsBedrock.secretAccessKey,
                apiKey:
                  typeof inboundState.settings.awsBedrock.apiKey === 'string'
                    ? encryptSecret(inboundState.settings.awsBedrock.apiKey)
                    : inboundState.settings.awsBedrock.apiKey
              }
            : inboundState.settings?.awsBedrock
        }
      }
    }

    if (key === 'settings') {
      return {
        ...inboundState,
        webdavPass:
          typeof inboundState.webdavPass === 'string'
            ? encryptSecret(inboundState.webdavPass)
            : inboundState.webdavPass,
        notionApiKey:
          typeof inboundState.notionApiKey === 'string'
            ? encryptSecret(inboundState.notionApiKey)
            : inboundState.notionApiKey,
        yuqueToken:
          typeof inboundState.yuqueToken === 'string'
            ? encryptSecret(inboundState.yuqueToken)
            : inboundState.yuqueToken,
        joplinToken:
          typeof inboundState.joplinToken === 'string'
            ? encryptSecret(inboundState.joplinToken)
            : inboundState.joplinToken,
        siyuanToken:
          typeof inboundState.siyuanToken === 'string'
            ? encryptSecret(inboundState.siyuanToken)
            : inboundState.siyuanToken,
        s3: inboundState.s3
          ? {
              ...inboundState.s3,
              accessKeyId:
                typeof inboundState.s3.accessKeyId === 'string'
                  ? encryptSecret(inboundState.s3.accessKeyId)
                  : inboundState.s3.accessKeyId,
              secretAccessKey:
                typeof inboundState.s3.secretAccessKey === 'string'
                  ? encryptSecret(inboundState.s3.secretAccessKey)
                  : inboundState.s3.secretAccessKey
            }
          : inboundState.s3,
        apiServer: inboundState.apiServer
          ? {
              ...inboundState.apiServer,
              apiKey:
                typeof inboundState.apiServer.apiKey === 'string'
                  ? encryptSecret(inboundState.apiServer.apiKey)
                  : inboundState.apiServer.apiKey
            }
          : inboundState.apiServer
      }
    }

    if (key === 'preprocess') {
      return {
        ...inboundState,
        providers: Array.isArray(inboundState.providers)
          ? inboundState.providers.map((provider: any) => ({
              ...provider,
              apiKey: typeof provider.apiKey === 'string' ? encryptSecret(provider.apiKey) : provider.apiKey
            }))
          : inboundState.providers
      }
    }

    if (key === 'websearch') {
      return {
        ...inboundState,
        providers: Array.isArray(inboundState.providers)
          ? inboundState.providers.map((provider: any) => ({
              ...provider,
              apiKey: typeof provider.apiKey === 'string' ? encryptSecret(provider.apiKey) : provider.apiKey
            }))
          : inboundState.providers
      }
    }

    if (key === 'nutstore') {
      return {
        ...inboundState,
        nutstoreToken:
          typeof inboundState.nutstoreToken === 'string'
            ? encryptSecret(inboundState.nutstoreToken)
            : inboundState.nutstoreToken
      }
    }

    return inboundState
  },
  (outboundState: any, key) => {
    if (!outboundState || typeof outboundState !== 'object') {
      return outboundState
    }

    if (key === 'llm') {
      return {
        ...outboundState,
        providers: Array.isArray(outboundState.providers)
          ? outboundState.providers.map((provider: any) => ({
              ...provider,
              apiKey: typeof provider.apiKey === 'string' ? decryptSecret(provider.apiKey) : provider.apiKey
            }))
          : outboundState.providers,
        settings: {
          ...outboundState.settings,
          vertexai: outboundState.settings?.vertexai
            ? {
                ...outboundState.settings.vertexai,
                serviceAccount: outboundState.settings.vertexai.serviceAccount
                  ? {
                      ...outboundState.settings.vertexai.serviceAccount,
                      privateKey:
                        typeof outboundState.settings.vertexai.serviceAccount.privateKey === 'string'
                          ? decryptSecret(outboundState.settings.vertexai.serviceAccount.privateKey)
                          : outboundState.settings.vertexai.serviceAccount.privateKey
                    }
                  : outboundState.settings.vertexai.serviceAccount
              }
            : outboundState.settings?.vertexai,
          awsBedrock: outboundState.settings?.awsBedrock
            ? {
                ...outboundState.settings.awsBedrock,
                accessKeyId:
                  typeof outboundState.settings.awsBedrock.accessKeyId === 'string'
                    ? decryptSecret(outboundState.settings.awsBedrock.accessKeyId)
                    : outboundState.settings.awsBedrock.accessKeyId,
                secretAccessKey:
                  typeof outboundState.settings.awsBedrock.secretAccessKey === 'string'
                    ? decryptSecret(outboundState.settings.awsBedrock.secretAccessKey)
                    : outboundState.settings.awsBedrock.secretAccessKey,
                apiKey:
                  typeof outboundState.settings.awsBedrock.apiKey === 'string'
                    ? decryptSecret(outboundState.settings.awsBedrock.apiKey)
                    : outboundState.settings.awsBedrock.apiKey
              }
            : outboundState.settings?.awsBedrock
        }
      }
    }

    if (key === 'settings') {
      return {
        ...outboundState,
        webdavPass:
          typeof outboundState.webdavPass === 'string'
            ? decryptSecret(outboundState.webdavPass)
            : outboundState.webdavPass,
        notionApiKey:
          typeof outboundState.notionApiKey === 'string'
            ? decryptSecret(outboundState.notionApiKey)
            : outboundState.notionApiKey,
        yuqueToken:
          typeof outboundState.yuqueToken === 'string'
            ? decryptSecret(outboundState.yuqueToken)
            : outboundState.yuqueToken,
        joplinToken:
          typeof outboundState.joplinToken === 'string'
            ? decryptSecret(outboundState.joplinToken)
            : outboundState.joplinToken,
        siyuanToken:
          typeof outboundState.siyuanToken === 'string'
            ? decryptSecret(outboundState.siyuanToken)
            : outboundState.siyuanToken,
        s3: outboundState.s3
          ? {
              ...outboundState.s3,
              accessKeyId:
                typeof outboundState.s3.accessKeyId === 'string'
                  ? decryptSecret(outboundState.s3.accessKeyId)
                  : outboundState.s3.accessKeyId,
              secretAccessKey:
                typeof outboundState.s3.secretAccessKey === 'string'
                  ? decryptSecret(outboundState.s3.secretAccessKey)
                  : outboundState.s3.secretAccessKey
            }
          : outboundState.s3,
        apiServer: outboundState.apiServer
          ? {
              ...outboundState.apiServer,
              apiKey:
                typeof outboundState.apiServer.apiKey === 'string'
                  ? decryptSecret(outboundState.apiServer.apiKey)
                  : outboundState.apiServer.apiKey
            }
          : outboundState.apiServer
      }
    }

    if (key === 'preprocess') {
      return {
        ...outboundState,
        providers: Array.isArray(outboundState.providers)
          ? outboundState.providers.map((provider: any) => ({
              ...provider,
              apiKey: typeof provider.apiKey === 'string' ? decryptSecret(provider.apiKey) : provider.apiKey
            }))
          : outboundState.providers
      }
    }

    if (key === 'websearch') {
      return {
        ...outboundState,
        providers: Array.isArray(outboundState.providers)
          ? outboundState.providers.map((provider: any) => ({
              ...provider,
              apiKey: typeof provider.apiKey === 'string' ? decryptSecret(provider.apiKey) : provider.apiKey
            }))
          : outboundState.providers
      }
    }

    if (key === 'nutstore') {
      return {
        ...outboundState,
        nutstoreToken:
          typeof outboundState.nutstoreToken === 'string'
            ? decryptSecret(outboundState.nutstoreToken)
            : outboundState.nutstoreToken
      }
    }

    return outboundState
  },
  {
    whitelist: ['llm', 'settings', 'preprocess', 'websearch', 'nutstore']
  }
)

const rootReducer = combineReducers({
  assistants,
  backup,
  codeTools,
  nutstore,
  paintings,
  llm,
  settings,
  runtime,
  shortcuts,
  knowledge,
  minapps,
  websearch,
  mcp,
  memory,
  copilot,
  selectionStore,
  tabs,
  preprocess,
  messages: newMessagesReducer,
  messageBlocks: messageBlocksReducer,
  inputTools: inputToolsReducer,
  translate,
  ocr,
  note,
  toolPermissions
})

const persistedReducer = persistReducer(
  {
    key: 'cherry-studio',
    storage,
    version: 183,
    blacklist: ['runtime', 'messages', 'messageBlocks', 'tabs', 'toolPermissions'],
    transforms: [securePersistTransform],
    migrate
  },
  rootReducer as any
)

/**
 * Configures the store sync service to synchronize specific state slices across all windows.
 * For detailed implementation, see @renderer/services/StoreSyncService.ts
 *
 * Usage:
 * - 'xxxx/' - Synchronizes the entire state slice
 * - 'xxxx/sliceName' - Synchronizes a specific slice within the state
 *
 * To listen for store changes in a window:
 * Call storeSyncService.subscribe() in the window's entryPoint.tsx
 */
storeSyncService.setOptions({
  syncList: ['assistants/', 'settings/', 'llm/', 'selectionStore/', 'note/']
})

const store = configureStore({
  // @ts-ignore store type is unknown
  reducer: persistedReducer as typeof rootReducer,
  middleware: (getDefaultMiddleware) => {
    return getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    }).concat(storeSyncService.createMiddleware())
  },
  devTools: true
})

export type RootState = ReturnType<typeof rootReducer>
export type AppDispatch = typeof store.dispatch

export const persistor = persistStore(store, undefined, () => {
  // Initialize notes path after rehydration if empty
  const state = store.getState()
  if (!state.note.notesPath) {
    // Use setTimeout to ensure this runs after the store is fully initialized
    setTimeout(async () => {
      try {
        const info = await window.api.getAppInfo()
        store.dispatch(setNotesPath(info.notesPath))
        logger.info('Initialized notes path on startup:', info.notesPath)
      } catch (error) {
        logger.error('Failed to initialize notes path on startup:', error as Error)
      }
    }, 0)
  }

  // Proactively flush once after rehydration so secrets are re-persisted in encrypted form.
  // This is best-effort and should never block app startup.
  const pathname = window.location?.pathname || ''
  const isMainWindow = pathname === '/' || pathname.endsWith('/index.html') || pathname.endsWith('index.html')
  if (isMainWindow && window.api?.safeStorage?.isEncryptionAvailable?.()) {
    setTimeout(() => {
      persistor.flush().catch(() => {})
    }, 0)
  }
})

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const useAppStore = useStore.withTypes<typeof store>()
window.store = store

export async function handleSaveData() {
  logger.info('Flushing redux persistor data')
  await persistor.flush()
  logger.info('Flushed redux persistor data')
}

export default store
