import { preferenceService } from '@renderer/data/PreferenceService'
import { ipcApi } from '@renderer/ipc'

import { setCustomExpressiveRules, setExpressiveEnabled } from './expressiveText'

let started: Promise<void> | undefined

/**
 * Hydrates the emoji/kaomoji label tables from the settings switch and the
 * rules the agent wrote, then keeps them current.
 *
 * Called from the playback service so every read path sees the same tables.
 * Failures are contained: speech still works with the built-in labels when a
 * preference or IPC call is unavailable.
 */
export function ensureExpressiveRulesLoaded(): Promise<void> {
  if (started) return started
  started = (async () => {
    try {
      const enabled = await preferenceService.get('feature.voice.speech.read_expressive')
      setExpressiveEnabled(enabled)
    } catch {
      // Keep the default (enabled).
    }

    try {
      const rules = await ipcApi.request('voice.expressive.list')
      if (Array.isArray(rules)) setCustomExpressiveRules(rules)
    } catch {
      // The built-in table remains usable.
    }

    try {
      preferenceService.subscribeChange('feature.voice.speech.read_expressive')(() => {
        void preferenceService.get('feature.voice.speech.read_expressive').then(setExpressiveEnabled)
      })
    } catch {
      // Older hosts or test doubles may not expose subscriptions.
    }

    try {
      ipcApi.on('voice.expressive.changed', (rules) => {
        if (Array.isArray(rules)) setCustomExpressiveRules(rules)
      })
    } catch {
      // Change notifications are an enhancement, not a requirement.
    }
  })()
  return started
}
