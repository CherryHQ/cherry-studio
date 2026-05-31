/**
 * Migration helper functions extracted from migrate.ts
 * These are shared utilities used by multiple migration functions.
 */
import { allMinApps } from '@renderer/config/minapps'
import { SYSTEM_PROVIDERS } from '@renderer/config/providers'
import type { BuiltinOcrProvider, Provider, WebSearchProvider } from '@renderer/types'
import { defaultPreprocessProviders } from '@renderer/store/preprocess'

import type { RootState } from '.'
import { defaultActionItems } from './selectionStore'
import { initialState as shortcutsInitialState } from './shortcuts'
import { defaultWebSearchProviders } from './websearch'

/**
 * Remove logo base64 data to reduce the size of the state
 */
export function removeMiniAppIconsFromState(state: RootState) {
  if (state.minapps) {
    state.minapps.enabled = state.minapps.enabled.map((app) => ({
      ...app,
      logo: undefined
    }))
    state.minapps.disabled = state.minapps.disabled.map((app) => ({
      ...app,
      logo: undefined
    }))
    state.minapps.pinned = state.minapps.pinned.map((app) => ({
      ...app,
      logo: undefined
    }))
  }
}

/**
 * Remove a mini app from all lists (pinned, enabled, disabled)
 */
export function removeMiniAppFromState(state: RootState, id: string) {
  if (state.minapps) {
    state.minapps.pinned = state.minapps.pinned.filter((app) => app.id !== id)
    state.minapps.enabled = state.minapps.enabled.filter((app) => app.id !== id)
    state.minapps.disabled = state.minapps.disabled.filter((app) => app.id !== id)
  }
}

/**
 * Add a mini app to the enabled list if not already present
 */
export function addMiniApp(state: RootState, id: string) {
  if (state.minapps) {
    const app = allMinApps.find((app) => app.id === id)
    if (app) {
      if (!state.minapps.enabled.find((app) => app.id === id)) {
        state.minapps.enabled.push(app)
      }
    }
  }
}

/**
 * Add a system provider to the state if not already present
 */
export function addProvider(state: RootState, id: string) {
  if (!state.llm.providers.find((p) => p.id === id)) {
    const _provider = SYSTEM_PROVIDERS.find((p) => p.id === id)
    if (_provider) {
      state.llm.providers.push(_provider)
    }
  }
}

/**
 * Fix missing providers by adding all system providers that are not in the state
 */
export function fixMissingProvider(state: RootState) {
  SYSTEM_PROVIDERS.forEach((p) => {
    if (!state.llm.providers.find((provider) => provider.id === p.id)) {
      state.llm.providers.push(p)
    }
  })
}

/**
 * Add an OCR provider to the state if not already present
 */
export function addOcrProvider(state: RootState, provider: BuiltinOcrProvider) {
  if (!state.ocr.providers.find((p) => p.id === provider.id)) {
    state.ocr.providers.push(provider)
  }
}

/**
 * Update a provider's properties by ID
 */
export function updateProvider(state: RootState, id: string, provider: Partial<Provider>) {
  if (state.llm.providers) {
    const index = state.llm.providers.findIndex((p) => p.id === id)
    if (index !== -1) {
      state.llm.providers[index] = {
        ...state.llm.providers[index],
        ...provider
      }
    }
  }
}

/**
 * Add a web search provider to the state if not already present
 */
export function addWebSearchProvider(state: RootState, id: string) {
  if (state.websearch && state.websearch.providers) {
    if (!state.websearch.providers.find((p) => p.id === id)) {
      const provider = defaultWebSearchProviders.find((p) => p.id === id)
      if (provider) {
        // Prevent mutating read only property of object
        state.websearch.providers.push({ ...provider })
      }
    }
  }
}

/**
 * Update a web search provider's properties
 */
export function updateWebSearchProvider(state: RootState, provider: Partial<WebSearchProvider>) {
  if (state.websearch && state.websearch.providers) {
    const index = state.websearch.providers.findIndex((p) => p.id === provider.id)
    if (index !== -1) {
      state.websearch.providers[index] = {
        ...state.websearch.providers[index],
        ...provider
      }
    }
  }
}

/**
 * Add a selection action to the state if not already present
 */
export function addSelectionAction(state: RootState, id: string) {
  if (state.selectionStore && state.selectionStore.actionItems) {
    if (!state.selectionStore.actionItems.some((item) => item.id === id)) {
      const action = defaultActionItems.find((item) => item.id === id)
      if (action) {
        state.selectionStore.actionItems.push(action)
      }
    }
  }
}

/**
 * Add shortcuts(ids from shortcutsInitialState) after the shortcut(afterId)
 * if afterId is 'first', add to the first
 * if afterId is 'last', add to the last
 */
export function addShortcuts(state: RootState, ids: string[], afterId: string) {
  const defaultShortcuts = shortcutsInitialState.shortcuts

  if (!state.shortcuts) {
    return
  }

  const shortcutsToAdd = defaultShortcuts.filter((shortcut) => ids.includes(shortcut.key))
  const existingKeys = state.shortcuts.shortcuts.map((s) => s.key)
  const newShortcuts = shortcutsToAdd.filter((shortcut) => !existingKeys.includes(shortcut.key))

  if (newShortcuts.length === 0) {
    return
  }

  if (afterId === 'first') {
    state.shortcuts.shortcuts.unshift(...newShortcuts)
  } else if (afterId === 'last') {
    state.shortcuts.shortcuts.push(...newShortcuts)
  } else {
    const afterIndex = state.shortcuts.shortcuts.findIndex((shortcut) => shortcut.key === afterId)
    if (afterIndex !== -1) {
      state.shortcuts.shortcuts.splice(afterIndex + 1, 0, ...newShortcuts)
    } else {
      state.shortcuts.shortcuts.push(...newShortcuts)
    }
  }
}

/**
 * Add a preprocess provider to the state if not already present
 */
export function addPreprocessProviders(state: RootState, id: string) {
  if (state.preprocess && state.preprocess.providers) {
    if (!state.preprocess.providers.find((p) => p.id === id)) {
      const provider = defaultPreprocessProviders.find((p) => p.id === id)
      if (provider) {
        state.preprocess.providers.push({ ...provider })
      }
    }
  }
}
