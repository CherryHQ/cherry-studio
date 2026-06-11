/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { combineReducers, configureStore } from '@reduxjs/toolkit'
// [v2] Removed: IpcChannel only referenced by the ReduxStoreReady signal below, which is now commented out.
// import { IpcChannel } from '@shared/IpcChannel'
import { useDispatch, useSelector, useStore } from 'react-redux'

// [v2] redux-persist removed — the Redux store is now in-memory only. These imports are
// commented out (not deleted) because everything under src/renderer/store/ is still read by
// the v2 data-classify inventory tooling. The matching <PersistGate> wrappers were deleted
// from the window entry points (outside store/).
// import { loggerService } from '@logger'
// import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist'
// import storage from 'redux-persist/lib/storage'
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
// [v2] redux-persist removed: `migrate` was only consumed by persistReducer below.
// import migrate from './migrate'
import minapps from './minapps'
import newMessagesReducer from './newMessage'
// [v2] redux-persist removed: `setNotesPath` was only dispatched by the persistor rehydration callback below.
// import { setNotesPath } from './note'
import note from './note'
import nutstore from './nutstore'
import ocr from './ocr'
import openclaw from './openclaw'
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

// [v2] redux-persist removed: const logger = loggerService.withContext('Store')

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
  openclaw,
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

// [v2] redux-persist removed — store no longer persists to localStorage or rehydrates on boot.
// const persistedReducer = persistReducer(
//   {
//     key: 'cherry-studio',
//     storage,
//     version: 207,
//     blacklist: ['runtime', 'messages', 'messageBlocks', 'tabs', 'toolPermissions'],
//     migrate
//   },
//   rootReducer
// )

const store = configureStore({
  // [v2] redux-persist removed — use rootReducer directly instead of the persisted reducer:
  //   reducer: persistedReducer as typeof rootReducer,  (the cast needed a ts-ignore)
  //   middleware: (getDefaultMiddleware) => getDefaultMiddleware({
  //     serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] }
  //   }),
  reducer: rootReducer,
  devTools: true
})

export type RootState = ReturnType<typeof rootReducer>
export type AppDispatch = typeof store.dispatch

// [v2] redux-persist removed — no persistor. The rehydration callback below initialised the
// legacy `note.notesPath` slice, which v2 no longer reads (notesPath now lives in the
// `feature.notes.path` preference, see useNotesSettings).
// export const persistor = persistStore(store, undefined, () => {
//   // Initialize notes path after rehydration if empty
//   const state = store.getState()
//   if (!state.note.notesPath) {
//     // Use setTimeout to ensure this runs after the store is fully initialized
//     setTimeout(async () => {
//       try {
//         const info = await window.api.getAppInfo()
//         store.dispatch(setNotesPath(info.notesPath))
//         logger.info('Initialized notes path on startup:', info.notesPath)
//       } catch (error) {
//         logger.error('Failed to initialize notes path on startup:', error as Error)
//       }
//     }, 0)
//   }
//
//   // [v2] Removed: ReduxService is stubbed in v2 and no longer registers a handler for this channel.
//   // void window.electron?.ipcRenderer?.invoke(IpcChannel.ReduxStoreReady)
//   // logger.info('Redux store ready, notified main process')
// })

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const useAppStore = useStore.withTypes<typeof store>()
window.store = store

// [v2] Removed: Redux persistor flush is no longer needed after v2 data refactoring
// export async function handleSaveData() {
//   logger.info('Flushing redux persistor data')
//   await persistor.flush()
//   logger.info('Flushed redux persistor data')
// }

export default store
