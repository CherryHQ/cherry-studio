import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSharedCacheValue } from '@data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { DoctorScopeKey } from '@shared/types/doctor'
import type { DoctorAgentState } from '@shared/types/doctorAgent'
import { doctorAgentStateCacheKey } from '@shared/utils/doctor'

const logger = loggerService.withContext('DoctorAgent')
const IDLE_STATE: DoctorAgentState = { status: 'idle' }

/** What the panel is waiting on; proposals and changes are keyed by their id. */
export type DoctorAgentBusy = { kind: 'start' } | { kind: 'cancel' } | { kind: 'apply' | 'undo'; id: string } | null

export function useDoctorAgent({ scope, reportRunId }: { scope: DoctorScopeKey; reportRunId?: string }) {
  const { t } = useTranslation()
  const state = useSharedCacheValue(doctorAgentStateCacheKey(scope)) ?? IDLE_STATE
  const [busy, setBusy] = useState<DoctorAgentBusy>(null)
  /** The analysis on screen read a report the user no longer sees; its proposals may not apply. */
  const isStale = state.status !== 'idle' && reportRunId !== undefined && state.reportRunId !== reportRunId

  const start = useCallback(async () => {
    if (!reportRunId) return
    setBusy({ kind: 'start' })
    try {
      const result = await ipcApi.request('diagnostics.doctor.agent.start', { scope, reportRunId })
      if (result.status === 'stale') toast.error(t('settings.doctor.messages.stale'))
      else if (result.status === 'no_model') toast.error(t('settings.doctor.agent.messages.no_model'))
    } catch (error) {
      logger.error('Failed to start the doctor analysis', error as Error)
      toast.error(t('settings.doctor.agent.messages.start_failed'))
    } finally {
      setBusy(null)
    }
  }, [reportRunId, scope, t])

  const cancel = useCallback(async () => {
    if (state.status !== 'running') return
    setBusy({ kind: 'cancel' })
    try {
      await ipcApi.request('diagnostics.doctor.agent.cancel', { scope, runId: state.runId })
    } catch (error) {
      logger.error('Failed to cancel the doctor analysis', error as Error)
      toast.error(t('settings.doctor.messages.cancel_failed'))
    } finally {
      setBusy(null)
    }
  }, [scope, state, t])

  const apply = useCallback(
    async (proposalId: string) => {
      if (state.status === 'idle') return
      setBusy({ kind: 'apply', id: proposalId })
      try {
        const result = await ipcApi.request('diagnostics.doctor.agent.apply', { scope, runId: state.runId, proposalId })
        if (result.status === 'applied') {
          toast.success(
            t(
              result.fix?.status === 'requires_relaunch'
                ? 'settings.doctor.messages.relaunch_required'
                : 'settings.doctor.agent.messages.applied'
            )
          )
        } else if (result.status === 'stale') toast.error(t('settings.doctor.messages.stale'))
        else toast.error(t('settings.doctor.agent.messages.apply_failed', { message: result.message }))
      } catch (error) {
        logger.error('Failed to apply a doctor proposal', error as Error)
        toast.error(t('settings.doctor.agent.messages.apply_failed', { message: String(error) }))
      } finally {
        setBusy(null)
      }
    },
    [scope, state, t]
  )

  const undo = useCallback(
    async (changeId: string) => {
      if (state.status === 'idle') return
      setBusy({ kind: 'undo', id: changeId })
      try {
        const result = await ipcApi.request('diagnostics.doctor.agent.undo', { scope, runId: state.runId, changeId })
        if (result.status === 'undone') toast.success(t('settings.doctor.agent.messages.undone'))
        else if (result.status === 'stale') toast.error(t('settings.doctor.messages.stale'))
        else toast.error(t('settings.doctor.agent.messages.undo_failed', { message: result.message }))
      } catch (error) {
        logger.error('Failed to undo a doctor change', error as Error)
        toast.error(t('settings.doctor.agent.messages.undo_failed', { message: String(error) }))
      } finally {
        setBusy(null)
      }
    },
    [scope, state, t]
  )

  return { state, isStale, busy, start, cancel, apply, undo }
}

export type DoctorAgentController = ReturnType<typeof useDoctorAgent>
