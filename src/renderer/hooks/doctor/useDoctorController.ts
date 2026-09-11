import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cacheService } from '@data/CacheService'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { buildDoctorViewModel, canCancelDoctorRun } from '@renderer/utils/doctor'
import {
  DOCTOR_CHECK_CATALOG,
  type DoctorAction,
  type DoctorCheckId,
  type DoctorFixRequest,
  type DoctorNavigateTarget,
  type DoctorRunTier,
  type DoctorScopeKey,
  type DoctorState,
  type DoctorSubjectRef
} from '@shared/types/doctor'
import { doctorCheckTitleKey, type DoctorPanel, doctorScopeKey } from '@shared/utils/doctor'

import { createDoctorSession, type DoctorInteraction, doctorSessionReducer } from './doctorSessionReducer'

const logger = loggerService.withContext('DoctorController')
const IDLE_DOCTOR_STATE: DoctorState = { status: 'idle' }

interface UseDoctorControllerOptions {
  readonly initialPanel: DoctorPanel
  readonly initialDescription?: string
  /** Absent = the global doctor. Present = diagnose one chat or agent; its state lives in its own scope. */
  readonly subject?: DoctorSubjectRef
  readonly onNavigate: (target: DoctorNavigateTarget) => void
  readonly onReportProblem?: (description: string) => void
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Doctor action: ${JSON.stringify(value)}`)
}

function fixRequestFor(
  scope: DoctorScopeKey,
  runId: string,
  checkId: DoctorCheckId,
  action: Extract<DoctorAction, { kind: 'fix' }>
): DoctorFixRequest | undefined {
  if (!DOCTOR_CHECK_CATALOG[checkId].fixes.some((candidate) => candidate.id === action.fixId)) return undefined
  return {
    scope,
    runId,
    checkId,
    fixId: action.fixId,
    ...(action.target ? { target: action.target } : {})
  } as DoctorFixRequest
}

export function useDoctorController({
  initialPanel,
  initialDescription,
  subject,
  onNavigate,
  onReportProblem
}: UseDoctorControllerOptions) {
  const { t } = useTranslation()
  const scope = doctorScopeKey(subject)
  const cachedDoctorState = useSharedCacheValue(`doctor.state.${scope}` as const)
  const [sharedCacheReady, setSharedCacheReady] = useState(() => cacheService.isSharedCacheReady())
  const doctorState = cachedDoctorState ?? IDLE_DOCTOR_STATE
  const { appUpdateState } = useAppUpdateState()
  const [session, dispatch] = useReducer(
    doctorSessionReducer,
    { initialPanel, initialDescription },
    createDoctorSession
  )
  const [now, setNow] = useState(Date.now)
  const [isAutoRunPending, setIsAutoRunPending] = useState(doctorState.status === 'idle')
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
        await ipcApi.request('diagnostics.doctor.run', subject ? { tier, subject } : { tier })
      } catch (error) {
        logger.error('Failed to run system diagnostics', error as Error)
        toast.error(t('settings.doctor.messages.run_failed'))
      } finally {
        dispatch({ type: 'finish-interaction', kind: 'run' })
      }
    },
    [subject, t]
  )

  useEffect(() => {
    if (!sharedCacheReady || autoRunRequestedRef.current) return
    if (doctorState.status === 'running') {
      autoRunRequestedRef.current = true
      setIsAutoRunPending(false)
      return
    }
    if (doctorState.status !== 'idle') {
      setIsAutoRunPending(false)
      return
    }
    autoRunRequestedRef.current = true
    void run('quick').finally(() => setIsAutoRunPending(false))
  }, [doctorState.status, run, sharedCacheReady])

  const cancel = useCallback(async () => {
    if (!canCancelDoctorRun(doctorState)) return
    dispatch({ type: 'start-interaction', interaction: { kind: 'cancel' } })
    try {
      await ipcApi.request('diagnostics.doctor.cancel', { scope, runId: doctorState.runId })
    } catch (error) {
      logger.error('Failed to cancel system diagnostics', error as Error)
      toast.error(t('settings.doctor.messages.cancel_failed'))
    } finally {
      dispatch({ type: 'finish-interaction', kind: 'cancel' })
    }
  }, [doctorState, scope, t])

  const performAction = useCallback(
    async (
      interaction: Omit<Extract<DoctorInteraction, { kind: 'action' }>, 'kind'>,
      operation: () => Promise<unknown>,
      errorMessage: string
    ) => {
      dispatch({ type: 'start-interaction', interaction: { kind: 'action', ...interaction } })
      try {
        await operation()
      } catch (error) {
        logger.error(errorMessage, error as Error)
        toast.error(t('settings.doctor.messages.action_failed'))
      } finally {
        dispatch({ type: 'finish-interaction', kind: 'action' })
      }
    },
    [t]
  )

  const performFix = useCallback(
    async (request: DoctorFixRequest) => {
      dispatch({ type: 'start-interaction', interaction: { kind: 'fixing', request } })
      try {
        const result = await ipcApi.request('diagnostics.doctor.fix', request)
        switch (result.status) {
          case 'fixed':
            dispatch({ type: 'mark-check-fixed', checkId: request.checkId })
            toast.success(t('settings.doctor.messages.fix_completed'))
            break
          case 'requires_relaunch':
            dispatch({ type: 'mark-check-fixed', checkId: request.checkId })
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
          const request = fixRequestFor(scope, runId, checkId, action)
          if (!request) return
          await performFix(request)
          return
        }
        case 'navigate':
          onNavigate(action.target)
          return
        case 'open_path':
          await performAction(
            { actionKind: action.kind, checkId },
            () => ipcApi.request('system.shell.open_path', action.path),
            'Failed to open a system diagnostics path'
          )
          return
        case 'open_external':
          await performAction(
            { actionKind: action.kind, checkId },
            () => ipcApi.request('system.shell.open_website', action.url),
            'Failed to open a system diagnostics link'
          )
          return
        case 'relaunch':
          await performAction(
            { actionKind: action.kind, checkId },
            () => ipcApi.request('app.relaunch'),
            'Failed to relaunch Cherry Studio'
          )
          return
        case 'report':
          const reportDescription =
            session.descriptionDraft.trim() ||
            t('settings.doctor.report.check_description', {
              checkId,
              title: t(doctorCheckTitleKey(checkId))
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
    [onNavigate, onReportProblem, performAction, performFix, scope, session.descriptionDraft, t, viewModel.isStale]
  )

  const openPath = useCallback(
    (path: string) =>
      performAction(
        { actionKind: 'open_path' },
        () => ipcApi.request('system.shell.open_path', path),
        'Failed to open the system diagnostics data path'
      ),
    [performAction]
  )

  const openLogsPath = useCallback(
    () =>
      performAction(
        { actionKind: 'open_path' },
        async () => {
          const { logsPath } = await ipcApi.request('app.get_info')
          await ipcApi.request('system.shell.open_path', logsPath)
        },
        'Failed to open the system diagnostics logs path'
      ),
    [performAction]
  )

  const toggleDevTools = useCallback(
    () =>
      performAction(
        { actionKind: 'toggle_dev_tools' },
        () => ipcApi.request('system.toggle_dev_tools'),
        'Failed to open developer tools from system diagnostics'
      ),
    [performAction]
  )

  const confirmEvidence = useCallback(() => {
    if (session.interaction.kind !== 'confirm-evidence') return
    dispatch({
      type: 'reveal-evidence',
      runId: session.interaction.runId,
      checkId: session.interaction.checkId
    })
    dispatch({ type: 'finish-interaction', kind: 'confirm-evidence' })
  }, [session.interaction])

  const requestEvidence = useCallback(
    (checkId: DoctorCheckId) => {
      if (!viewModel.runId) return
      dispatch({ type: 'confirm-evidence', runId: viewModel.runId, checkId })
    },
    [viewModel.runId]
  )

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
    isAutoRunPending,
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
    requestEvidence,
    viewModel
  }
}

export type DoctorController = ReturnType<typeof useDoctorController>
