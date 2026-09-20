import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { SettingsContentColumn, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { AgentHookListSchema, type AgentHook } from '@shared/ai/agentHook'

import { AgentHooksField } from './components/AgentHooksField'

const logger = loggerService.withContext('HooksSettings')
const PREFERENCE_OPTIONS = { optimistic: false } as const
const AUTO_SAVE_DELAY_MS = 400
// Remounts must wait for saves that outlive the previous editor.
let saveQueue = Promise.resolve()
let pendingEdit: { hooks: AgentHook[]; failed: boolean } | null = null

export function HooksSettings() {
  const { t } = useTranslation()
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void saveQueue
      .then(() => preferenceService.get('agent.hooks'))
      .then(() => {
        if (active) setLoadStatus(preferenceService.isCached('agent.hooks') ? 'ready' : 'error')
      })
      .catch((error) => {
        logger.error('Failed to load global Hooks', error as Error)
        if (active) setLoadStatus('error')
      })
    return () => {
      active = false
    }
  }, [loadAttempt])

  return (
    <SettingsContentColumn>
      <div className="space-y-4">
        <SettingTitle>{t('settings.hooks.title')}</SettingTitle>
        <p className="text-muted-foreground text-sm">{t('settings.hooks.description')}</p>
        {loadStatus === 'error' ? (
          <Alert
            type="error"
            message={t('common.error')}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoadStatus('loading')
                  setLoadAttempt((attempt) => attempt + 1)
                }}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : loadStatus === 'loading' ? (
          <p role="status" className="py-8 text-center text-muted-foreground text-sm">
            {t('common.loading')}
          </p>
        ) : (
          <GlobalHooksEditor />
        )}
      </div>
    </SettingsContentColumn>
  )
}

function GlobalHooksEditor() {
  const { t } = useTranslation()
  const [storedHooks, setStoredHooks] = usePreference('agent.hooks', PREFERENCE_OPTIONS)
  const [draft, setDraft] = useState<AgentHook[] | null>(pendingEdit?.hooks ?? null)
  const [saveFailed, setSaveFailed] = useState(pendingEdit?.failed ?? false)
  const draftRef = useRef(draft)
  const revisionRef = useRef(draft ? 1 : 0)
  const lastSavedRevisionRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const stored = AgentHookListSchema.safeParse(storedHooks)
  const hooks = draft ?? (stored.success ? stored.data : [])
  const parsed = AgentHookListSchema.safeParse(hooks)

  const enqueueSave = useCallback(() => {
    const requestedRevision = revisionRef.current
    saveQueue = saveQueue.then(async () => {
      if (lastSavedRevisionRef.current >= requestedRevision) return

      const snapshot = draftRef.current
      if (!snapshot) return
      const snapshotRevision = revisionRef.current
      const validated = AgentHookListSchema.safeParse(snapshot)
      if (!validated.success) return

      try {
        await setStoredHooks(validated.data)
        lastSavedRevisionRef.current = snapshotRevision
        if (revisionRef.current === snapshotRevision) {
          pendingEdit = null
          draftRef.current = null
          if (mountedRef.current) setDraft(null)
        }
        if (mountedRef.current) setSaveFailed(false)
      } catch (error) {
        logger.error('Failed to auto-save global Hooks', error as Error)
        if (pendingEdit) pendingEdit.failed = true
        if (mountedRef.current) setSaveFailed(true)
      }
    })
    return saveQueue
  }, [setStoredHooks])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (draftRef.current) void enqueueSave()
    }
  }, [enqueueSave])

  const updateHooks = (next: AgentHook[], options?: { immediate?: boolean }) => {
    revisionRef.current += 1
    pendingEdit = { hooks: next, failed: false }
    draftRef.current = next
    setDraft(next)
    setSaveFailed(false)

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (options?.immediate) {
      void enqueueSave()
    } else {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        void enqueueSave()
      }, AUTO_SAVE_DELAY_MS)
    }
  }

  return (
    <div className="space-y-4">
      {!stored.success || !parsed.success ? <Alert type="error" message={t('settings.hooks.invalid')} /> : null}
      {saveFailed ? (
        <Alert
          type="error"
          message={t('settings.hooks.save_failed')}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSaveFailed(false)
                void enqueueSave()
              }}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : null}
      {stored.success ? (
        <fieldset className="min-w-0">
          <AgentHooksField value={hooks} onChange={updateHooks} />
        </fieldset>
      ) : null}
    </div>
  )
}
