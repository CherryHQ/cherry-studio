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
    // Observe before reading. A change that lands while the initial read is in
    // flight increments the epoch, so the older read result cannot overwrite it.
    let preferenceEpoch = 0
    try {
      preferenceService.subscribeChange('feature.voice.speech.read_expressive')(() => {
        preferenceEpoch += 1
        void preferenceService
          .get('feature.voice.speech.read_expressive')
          .then(setExpressiveEnabled)
          .catch(() => {
            // Keep the last known switch value.
          })
      })
    } catch {
      // Older hosts or test doubles may not expose subscriptions.
    }

    const preferenceEpochAtRead = preferenceEpoch
    try {
      const enabled = await preferenceService.get('feature.voice.speech.read_expressive')
      if (preferenceEpoch === preferenceEpochAtRead) setExpressiveEnabled(enabled)
    } catch {
      // Keep the default (enabled).
    }

    let rulesEpoch = 0
    try {
      ipcApi.on('voice.expressive.changed', (rules) => {
        rulesEpoch += 1
        if (Array.isArray(rules)) setCustomExpressiveRules(rules)
      })
    } catch {
      // Change notifications are an enhancement, not a requirement.
    }

    const rulesEpochAtList = rulesEpoch
    try {
      const rules = await ipcApi.request('voice.expressive.list')
      if (rulesEpoch === rulesEpochAtList && Array.isArray(rules)) setCustomExpressiveRules(rules)
    } catch {
      // The built-in table remains usable.
    }
  })()
  return started
}
