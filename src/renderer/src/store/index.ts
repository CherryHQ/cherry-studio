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
import { decryptPersistSliceState, encryptPersistSliceState, SECURE_PERSIST_SLICE_KEYS } from '../utils/securePersist'
import type { CredentialIssue } from '../utils/secureStorage'
import { consumeCredentialIssues, CREDENTIAL_ISSUE_EVENT_NAME } from '../utils/secureStorage'
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
import runtime, { addCredentialIssue, setCredentialIssues } from './runtime'
import selectionStore from './selectionStore'
import settings from './settings'
import shortcuts from './shortcuts'
import tabs from './tabs'
import toolPermissions from './toolPermissions'
import translate from './translate'
import websearch from './websearch'

const logger = loggerService.withContext('Store')
let credentialIssueListenerAttached = false

const securePersistTransform = createTransform(
  (inboundState: any, key) => encryptPersistSliceState(String(key), inboundState),
  (outboundState: any, key) => decryptPersistSliceState(String(key), outboundState),
  {
    whitelist: [...SECURE_PERSIST_SLICE_KEYS]
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

  const issues = consumeCredentialIssues()
  if (issues.length > 0) {
    store.dispatch(setCredentialIssues(issues))
  }

  if (
    !credentialIssueListenerAttached &&
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    credentialIssueListenerAttached = true
    window.addEventListener(CREDENTIAL_ISSUE_EVENT_NAME, ((event: Event) => {
      const issue = (event as CustomEvent).detail as CredentialIssue | undefined
      if (!issue || typeof issue.id !== 'string' || typeof issue.reason !== 'string') {
        return
      }
      store.dispatch(addCredentialIssue(issue))
    }) as EventListener)
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
