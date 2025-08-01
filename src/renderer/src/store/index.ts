import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { loggerService } from '@renderer/services/LoggerService'
import { useDispatch, useSelector, useStore } from 'react-redux'
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist'
import storage from 'redux-persist/lib/storage'

import storeSyncService from '../services/StoreSyncService'
import agents from './agents'
import assistants from './assistants'
import backup from './backup'
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
import nutstore from './nutstore'
import paintings from './paintings'
import preprocess from './preprocess'
import runtime from './runtime'
import selectionStore from './selectionStore'
import settings from './settings'
import shortcuts from './shortcuts'
import tabs from './tabs'
import translate from './translate'
import websearch from './websearch'

const logger = loggerService.withContext('Store')

const rootReducer = combineReducers({
  assistants,
  agents,
  backup,
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
  translate
})

const persistedReducer = persistReducer(
  {
    key: 'cherry-studio',
    storage,
    version: 126,
    blacklist: ['runtime', 'messages', 'messageBlocks', 'tabs'],
    migrate
  },
  rootReducer
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
  syncList: ['assistants/', 'settings/', 'llm/', 'selectionStore/']
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

export const persistor = persistStore(store)
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const useAppStore = useStore.withTypes<typeof store>()
window.store = store

export async function handleSaveData() {
  try {
    logger.info('Starting data save process')

    // 1. 保存 Redux 数据到 localStorage
    logger.info('Flushing redux persistor data')
    await persistor.flush()
    logger.info('Flushed redux persistor data')

    // 2. 取消所有节流的消息块更新，确保立即保存
    const state = store.getState()
    const allBlockIds = Object.keys(state.messageBlocks.entities)

    if (allBlockIds.length > 0) {
      logger.info(`Canceling throttled updates for ${allBlockIds.length} blocks`)
      // 动态导入以避免循环依赖
      const { cancelThrottledBlockUpdate } = await import('./thunk/messageThunk')
      allBlockIds.forEach((blockId) => {
        cancelThrottledBlockUpdate(blockId)
      })
    }

    // 3. 等待 IndexedDB 操作完成
    logger.info('Waiting for IndexedDB operations to complete')
    // 给 IndexedDB 一些时间完成所有挂起的事务
    await new Promise((resolve) => setTimeout(resolve, 100))

    logger.info('Data save process completed')
  } catch (error) {
    logger.error('Failed to save data:', error as Error)
  }
}

export default store
