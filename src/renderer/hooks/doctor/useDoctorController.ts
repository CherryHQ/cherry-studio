import { cacheService } from '@data/CacheService'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { buildDoctorViewModel, canCancelDoctorRun, DOCTOR_CHECK_CONTENT } from '@renderer/utils/doctor'
import {
  DOCTOR_CHECK_CATALOG,
  type DoctorAction,
  type DoctorCheckId,
  type DoctorFixRequest,
  type DoctorNavigateTarget,
  type DoctorRunTier,
  type DoctorState
} from '@shared/types/doctor'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  createDoctorSession,
  type DoctorInteraction,
  type DoctorPanel,
  doctorSessionReducer
} from './doctorSessionReducer'

const logger = loggerService.withContext('DoctorController')
const IDLE_DOCTOR_STATE: DoctorState = { status: 'idle' }

interface UseDoctorControllerOptions {
  readonly initialPanel: DoctorPanel
  readonly initialDescription?: string
  readonly onNavigate: (target: DoctorNavigateTarget) => void
  readonly onReportProblem?: (description: string) => void
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Doctor action: ${JSON.stringify(value)}`)
}

function fixRequestFor(
  runId: string,
  checkId: DoctorCheckId,
  action: Extract<DoctorAction, { kind: 'fix' }>
): DoctorFixRequest | undefined {
  if (!DOCTOR_CHECK_CATALOG[checkId].fixes.some((candidate) => candidate.id === action.fixId)) return undefined
  return {
    runId,
    checkId,
    fixId: action.fixId,
    ...(action.target ? { target: action.target } : {})
  } as DoctorFixRequest
}

export function useDoctorController({
  initialPanel,
  initialDescription,
  onNavigate,
  onReportProblem
}: UseDoctorControllerOptions) {
  const { t } = useTranslation()
  const cachedDoctorState = useSharedCacheValue('doctor.state')
  const [sharedCacheReady, setSharedCacheReady] = useState(() => cacheService.isSharedCacheReady())
  const doctorState = cachedDoctorState ?? IDLE_DOCTOR_STATE
  const { appUpdateState } = useAppUpdateState()
  const [session, dispatch] = useReducer(
    doctorSessionReducer,
    { initialPanel, initialDescription },
    createDoctorSession
  )
  const [now, setNow] = useState(Date.now)
  const autoRunRequestedRef = useRef(false)

  useEffect(() => {
    if (sharedCacheReady) return
    return cacheService.onSharedCacheReady(() => setSharedCacheReady(true))
  }, [sharedCacheReady])

  useEffect(() => {
    if (doctorState.status !== 'completed') return
    const remaining = Date.parse(doctorState.report.expiresAt) - Date.now()
    if (remaining <= 0) {
      setNow(Date.now())
      return
    }
    const timer = window.setTimeout(() => setNow(Date.now()), remaining)
    return () => window.clearTimeout(timer)
  }, [doctorState])

  const viewModel = useMemo(() => buildDoctorViewModel(doctorState, now), [doctorState, now])
  const isInteracting = session.interaction.kind !== 'idle'
  const isCloseBlocked =
    session.interaction.kind === 'fixing' ||
    session.interaction.kind === 'action' ||
    session.interaction.kind === 'bundle-operation' ||
    session.interaction.kind === 'report-operation'
  const canChangePanel = !isCloseBlocked && session.interaction.kind !== 'confirm-evidence'

  const run = useCallback(
    async (tier: DoctorRunTier) => {
      dispatch({
        type: 'start-interaction',
        interaction: { kind: 'run', tier }
      })
      try {
        await ipcApi.request('diagnostics.doctor.run', { tier })
      } catch (error) {
        logger.error('Failed to run system diagnostics', error as Error)
        toast.error(t('settings.doctor.messages.run_failed'))
      } finally {
        dispatch({ type: 'finish-interaction', kind: 'run' })
      }
    },
    [t]
  )

  useEffect(() => {
    if (!sharedCacheReady || autoRunRequestedRef.current) return
    if (doctorState.status === 'running') {
      autoRunRequestedRef.current = true
      return
    }
    if (doctorState.status !== 'idle') return
    autoRunRequestedRef.current = true
    void run('quick')
  }, [doctorState.status, run, sharedCacheReady])

  const cancel = useCallback(async () => {
    if (!canCancelDoctorRun(doctorState)) return
    dispatch({ type: 'start-interaction', interaction: { kind: 'cancel' } })
    try {
      await ipcApi.request('diagnostics.doctor.cancel', { runId: doctorState.runId })
    } catch (error) {
      logger.error('Failed to cancel system diagnostics', error as Error)
      toast.error(t('settings.doctor.messages.cancel_failed'))
    } finally {
      dispatch({ type: 'finish-interaction', kind: 'cancel' })
    }
  }, [doctorState, t])

  const performFix = useCallback(
    async (request: DoctorFixRequest) => {
      dispatch({ type: 'start-interaction', interaction: { kind: 'fixing', request } })
      try {
        const result = await ipcApi.request('diagnostics.doctor.fix', request)
        switch (result.status) {
          case 'fixed':
            toast.success(t('settings.doctor.messages.fix_completed'))
            break
          case 'requires_relaunch':
            dispatch({ type: 'mark-relaunch-required' })
            toast.success(t('settings.doctor.messages.relaunch_required'))
            break
          case 'failed':
            toast.error(t('settings.doctor.messages.fix_failed'))
            break
          case 'stale':
            toast.error(t('settings.doctor.messages.result_changed'))
            break
        }
      } catch (error) {
        logger.error('Failed to apply a system diagnostics action', error as Error)
        toast.error(t('settings.doctor.messages.fix_failed'))
      } finally {
        dispatch({ type: 'finish-interaction', kind: 'fixing' })
      }
    },
    [t]
  )

  const executeAction = useCallback(
    async (checkId: DoctorCheckId, action: DoctorAction, runId?: string) => {
      if (viewModel.isStale) {
        toast.error(t('settings.doctor.messages.stale'))
        return
      }
      switch (action.kind) {
        case 'fix': {
          if (!runId) return
          const request = fixRequestFor(runId, checkId, action)
          if (!request) return
          await performFix(request)
          return
        }
        case 'navigate':
          onNavigate(action.target)
          return
        case 'open_path':
          dispatch({ type: 'start-interaction', interaction: { kind: 'action', actionKind: action.kind, checkId } })
          try {
            await ipcApi.request('system.shell.open_path', action.path)
          } catch (error) {
            logger.error('Failed to open a system diagnostics path', error as Error)
            toast.error(t('settings.doctor.messages.action_failed'))
          } finally {
            dispatch({ type: 'finish-interaction', kind: 'action' })
          }
          return
        case 'open_external':
          dispatch({ type: 'start-interaction', interaction: { kind: 'action', actionKind: action.kind, checkId } })
          try {
            await ipcApi.request('system.shell.open_website', action.url)
          } catch (error) {
            logger.error('Failed to open a system diagnostics link', error as Error)
            toast.error(t('settings.doctor.messages.action_failed'))
          } finally {
            dispatch({ type: 'finish-interaction', kind: 'action' })
          }
          return
        case 'relaunch':
          dispatch({ type: 'start-interaction', interaction: { kind: 'action', actionKind: action.kind, checkId } })
          try {
            await ipcApi.request('app.relaunch')
          } catch (error) {
            logger.error('Failed to relaunch Cherry Studio', error as Error)
            toast.error(t('settings.doctor.messages.action_failed'))
          } finally {
            dispatch({ type: 'finish-interaction', kind: 'action' })
          }
          return
        case 'report':
          const reportDescription =
            session.descriptionDraft.trim() ||
            t('settings.doctor.report.check_description', {
              checkId,
              title: t(DOCTOR_CHECK_CONTENT[checkId].title)
            })
          if (onReportProblem) {
            onReportProblem(reportDescription)
            return
          }
          if (session.descriptionDraft.trim().length === 0) {
            dispatch({
              type: 'set-description',
              description: reportDescription
            })
          }
          dispatch({ type: 'set-panel', panel: 'report' })
          return
        default:
          return assertNever(action)
      }
    },
    [onNavigate, onReportProblem, performFix, session.descriptionDraft, t, viewModel.isStale]
  )

  const openPath = useCallback(
    async (path: string) => {
      dispatch({ type: 'start-interaction', interaction: { kind: 'action', actionKind: 'open_path' } })
      try {
        await ipcApi.request('system.shell.open_path', path)
      } catch (error) {
        logger.error('Failed to open the system diagnostics data path', error as Error)
        toast.error(t('settings.doctor.messages.action_failed'))
      } finally {
        dispatch({ type: 'finish-interaction', kind: 'action' })
      }
    },
    [t]
  )

  const openLogsPath = useCallback(async () => {
    dispatch({ type: 'start-interaction', interaction: { kind: 'action', actionKind: 'open_path' } })
    try {
      const { logsPath } = await ipcApi.request('app.get_info')
      await ipcApi.request('system.shell.open_path', logsPath)
    } catch (error) {
      logger.error('Failed to open the system diagnostics logs path', error as Error)
      toast.error(t('settings.doctor.messages.action_failed'))
    } finally {
      dispatch({ type: 'finish-interaction', kind: 'action' })
    }
  }, [t])

  const toggleDevTools = useCallback(async () => {
    dispatch({ type: 'start-interaction', interaction: { kind: 'action', actionKind: 'toggle_dev_tools' } })
    try {
      await ipcApi.request('system.toggle_dev_tools')
    } catch (error) {
      logger.error('Failed to open developer tools from system diagnostics', error as Error)
      toast.error(t('settings.doctor.messages.action_failed'))
    } finally {
      dispatch({ type: 'finish-interaction', kind: 'action' })
    }
  }, [t])

  const confirmEvidence = useCallback(() => {
    if (session.interaction.kind !== 'confirm-evidence') return
    dispatch({ type: 'reveal-evidence', checkId: session.interaction.checkId })
    dispatch({ type: 'finish-interaction', kind: 'confirm-evidence' })
  }, [session.interaction])

  const setPanel = useCallback(
    (panel: DoctorPanel) => {
      if (canChangePanel) dispatch({ type: 'set-panel', panel })
    },
    [canChangePanel]
  )

  const setPanelInteraction = useCallback((kind: 'bundle-operation' | 'report-operation', active: boolean) => {
    dispatch(active ? { type: 'start-interaction', interaction: { kind } } : { type: 'finish-interaction', kind })
  }, [])

  return {
    appUpdateState,
    cancel,
    canChangePanel,
    cancelConfirmation: () => dispatch({ type: 'cancel-confirmation' }),
    confirmEvidence,
    executeAction,
    isInteracting,
    isCloseBlocked,
    openLogsPath,
    openPath,
    run,
    session,
    setDescription: (description: string) => dispatch({ type: 'set-description', description }),
    setPanel,
    setPanelInteraction,
    toggleDevTools,
    requestEvidence: (checkId: DoctorCheckId) => dispatch({ type: 'confirm-evidence', checkId }),
    viewModel
  }
}

export type DoctorController = ReturnType<typeof useDoctorController>
export type { DoctorInteraction, DoctorPanel }
