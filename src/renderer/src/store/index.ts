import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector, useStore } from 'react-redux'
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist'
import storage from 'redux-persist/lib/storage'

import agents from './agents'
import assistants from './assistants'
import knowledge from './knowledge'
import llm from './llm'
import migrate from './migrate'
import minapps from './minapps'
import paintings from './paintings'
import runtime from './runtime'
import settings from './settings'
import shortcuts from './shortcuts'
import websearch from './websearch'

const rootReducer = combineReducers({
  assistants,
  agents,
  paintings,
  llm,
  settings,
  runtime,
  shortcuts,
  knowledge,
  minapps,
  websearch
})

const persistedReducer = persistReducer(
  {
    key: 'cherry-studio',
    storage,
    version: 72,
    blacklist: ['runtime'],
    migrate
  },
  rootReducer
)

const store = configureStore({
  // @ts-ignore store type is unknown
  reducer: persistedReducer as typeof rootReducer,
  middleware: (getDefaultMiddleware) => {
    return getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    })
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

export default store
