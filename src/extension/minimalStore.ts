/**
 * Minimal Redux Store for Chrome Extension Sidepanel
 *
 * Only includes essential slices needed for basic chat functionality:
 * - assistants: Assistant configurations and topics
 * - settings: User preferences (theme, language, etc.)
 * - llm: Provider and model configurations
 * - runtime: Active topic, assistant, loading state
 * - messages: Message state (NOT persisted)
 * - messageBlocks: Message content blocks (NOT persisted)
 * - inputTools: Inputbar tool states
 *
 * Excludes: backup, paintings, knowledge, websearch, mcp, memory, copilot, etc.
 */

import { combineReducers, configureStore } from '@reduxjs/toolkit'
// Essential slices only
import assistantsReducer from '@renderer/store/assistants'
// backup is needed because settings imports types from it
import backupReducer from '@renderer/store/backup'
import inputToolsReducer from '@renderer/store/inputTools'
import llmReducer from '@renderer/store/llm'
import messageBlocksReducer from '@renderer/store/messageBlock'
import newMessagesReducer from '@renderer/store/newMessage'
import runtimeReducer from '@renderer/store/runtime'
import settingsReducer from '@renderer/store/settings'
import { persistReducer, persistStore } from 'redux-persist'
import storage from 'redux-persist/lib/storage'

const rootReducer = combineReducers({
  assistants: assistantsReducer,
  settings: settingsReducer,
  llm: llmReducer,
  runtime: runtimeReducer,
  messages: newMessagesReducer,
  messageBlocks: messageBlocksReducer,
  inputTools: inputToolsReducer,
  backup: backupReducer
})

const persistConfig = {
  key: 'cherry-studio-minimal',
  storage,
  version: 1,
  // Don't persist runtime state or message data
  blacklist: ['runtime', 'messages', 'messageBlocks']
}

const persistedReducer = persistReducer(persistConfig, rootReducer)

export const minimalStore = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE', 'persist/REGISTER'],
        ignoredActionPaths: ['register', 'rehydrate'],
        ignoredPaths: ['register']
      }
    })
})

export const minimalPersistor = persistStore(minimalStore)

// Export types for TypeScript
export type MinimalRootState = ReturnType<typeof minimalStore.getState>
export type MinimalAppDispatch = typeof minimalStore.dispatch

// Typed hooks for minimal store
import { useDispatch, useSelector } from 'react-redux'

export const useMinimalAppDispatch = useDispatch.withTypes<MinimalAppDispatch>()
export const useMinimalAppSelector = useSelector.withTypes<MinimalRootState>()
