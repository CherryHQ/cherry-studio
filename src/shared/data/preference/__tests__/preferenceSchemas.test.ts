import { describe, expect, it } from 'vitest'

import type { PreferenceSchemas } from '../preferenceSchemas'
import { DefaultPreferences } from '../preferenceSchemas'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '../preferenceTypes'

describe('DefaultPreferences', () => {
  it('keeps notification history enabled while sound, usage popups and an unset budget remain opt-in', () => {
    const defaults = DefaultPreferences.default as Record<string, unknown>
    expect({
      system: defaults['app.notification.center.system.enabled'],
      usage: defaults['app.notification.center.usage.enabled'],
      official: defaults['app.notification.center.official.enabled'],
      os: defaults['app.notification.usage.os.enabled'],
      sound: defaults['app.notification.completion_sound.enabled'],
      budget: defaults['app.notification.daily_budget.tokens'],
      threshold: defaults['app.notification.daily_budget.threshold']
    }).toEqual({ system: true, usage: true, official: true, os: false, sound: false, budget: 0, threshold: 80 })
  })

  it('seeds Voice selections without guessing resources or enabling auto-read', () => {
    const speechSpeed: PreferenceSchemas['default']['feature.voice.speech.speed'] = 1
    const recognitionModelId: PreferenceSchemas['default']['feature.voice.recognition.model_id'] = ''
    const autoRead: PreferenceSchemas['default']['feature.voice.auto_read.enabled'] = false
    const defaults = DefaultPreferences.default as Record<string, unknown>

    expect({
      recognitionModelId: defaults['feature.voice.recognition.model_id'],
      recognitionLanguage: defaults['feature.voice.recognition.language'],
      speechModelId: defaults['feature.voice.speech.model_id'],
      speechVoiceId: defaults['feature.voice.speech.voice_id'],
      speechLanguage: defaults['feature.voice.speech.language'],
      speechSpeed: defaults['feature.voice.speech.speed'],
      autoRead: defaults['feature.voice.auto_read.enabled'],
      disclosureConfirmed: defaults['feature.voice.auto_read.disclosure_confirmed']
    }).toEqual({
      recognitionModelId: '',
      recognitionLanguage: '',
      speechModelId: '',
      speechVoiceId: '',
      speechLanguage: '',
      speechSpeed,
      autoRead,
      disclosureConfirmed: false
    })
    expect(recognitionModelId).toBe('')
  })

  it('preserves the legacy favorites shape independently of resource shortcut defaults', () => {
    const legacyFavorites: PreferenceSchemas['default']['ui.sidebar.favorites'] = [
      { type: 'app', id: 'agents' },
      { type: 'app', id: 'assistants' },
      { type: 'app', id: 'translate' },
      { type: 'app', id: 'paintings' },
      { type: 'app', id: 'knowledge' }
    ]
    expect(DefaultPreferences.default['ui.sidebar.favorites']).toEqual(legacyFavorites)

    const sidebarShortcutsDefault: PreferenceSchemas['default']['ui.sidebar_shortcut'] = [
      'agents',
      'assistants',
      'scheduled_tasks',
      'translate',
      'paintings',
      'knowledge'
    ].map((resourceId) => {
      const target: SidebarShortcutTarget = {
        kind: 'resource',
        locator: { providerId: 'core.app', resourceId }
      }
      return { type: 'shortcut', id: createSidebarShortcutId(target), target }
    })

    expect(DefaultPreferences.default['ui.sidebar_shortcut']).toEqual(sidebarShortcutsDefault)
  })
})
