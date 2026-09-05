import { cacheService } from '@data/CacheService'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { buildDoctorViewModel, defaultExpandedDoctorDomains, DOCTOR_CHECK_CONTENT } from '@renderer/utils/doctor'
import {
  DOCTOR_CHECK_CATALOG,
  type DoctorAction,
  type DoctorCheckId,
  type DoctorFixMeta,
  type DoctorFixRequest,
  type DoctorNavigateTarget,
  type DoctorRunTier,
  type DoctorState
} from '@shared/types/doctor'
import type { UpdateInfo } from 'builder-util-runtime'
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
const EMBEDDED_RUN_FEEDBACK_MS = 600
type DoctorAutoRunPolicy = 'when-idle' | 'when-not-running'

interface UseDoctorControllerOptions {
  readonly autoRunPolicy?: DoctorAutoRunPolicy
  readonly initialPanel: DoctorPanel
  readonly initialDescription?: string
  readonly onInstallUpdate: (releaseInfo: UpdateInfo) => void
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
): { readonly meta: DoctorFixMeta; readonly request: DoctorFixRequest } | undefined {
  const meta = (DOCTOR_CHECK_CATALOG[checkId].fixes as readonly DoctorFixMeta[]).find(
    (candidate) => candidate.id === action.fixId
  )
  if (!meta) return undefined
  return {
    meta,
    request: {
      runId,
      checkId,
      fixId: action.fixId,
      ...(action.target ? { target: action.target } : {})
    } as DoctorFixRequest
  }
}

export function useDoctorController({
  autoRunPolicy = 'when-idle',
  initialPanel,
  initialDescription,
  onInstallUpdate,
  onNavigate,
  onReportProblem
}: UseDoctorControllerOptions) {
  const { t } = useTranslation()
  const cachedDoctorState = useSharedCacheValue('doctor.state')
  const [sharedCacheReady, setSharedCacheReady] = useState(() => cacheService.isSharedCacheReady())
  const doctorState = cachedDoctorState ?? IDLE_DOCTOR_STATE
  const { appUpdateState } = useAppUpdateState()
  const { mcpServers } = useMcpServers()
  const [session, dispatch] = useReducer(
    doctorSessionReducer,
    { initialPanel, initialDescription },
    createDoctorSession
  )
  const [now, setNow] = useState(Date.now)
  const autoRunRequestedRef = useRef(false)
  const expandedRunIdRef = useRef<string | null>(null)

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

  const pendingRunTier =
    session.interaction.kind === 'run' && now < session.interaction.pendingUntil ? session.interaction.tier : undefined
  const viewModel = useMemo(
    () => buildDoctorViewModel(doctorState, now, pendingRunTier),
    [doctorState, now, pendingRunTier]
  )
  const isInteracting = session.interaction.kind !== 'idle'
  const isCloseBlocked =
    session.interaction.kind === 'fixing' ||
    session.interaction.kind === 'action' ||
    session.interaction.kind === 'bundle-operation' ||
    session.interaction.kind === 'report-operation'
  const canChangePanel =
    !isCloseBlocked && session.interaction.kind !== 'confirm-fix' && session.interaction.kind !== 'confirm-evidence'

  useEffect(() => {
    if (!viewModel.report || expandedRunIdRef.current === viewModel.report.runId) return
    expandedRunIdRef.current = viewModel.report.runId
    dispatch({ type: 'set-expanded-domains', domains: defaultExpandedDoctorDomains(viewModel.groups) })
  }, [viewModel.groups, viewModel.report])

  useEffect(() => {
    if (session.interaction.kind !== 'run') return
    const remaining = session.interaction.pendingUntil - Date.now()
    if (remaining <= 0) {
      setNow(Date.now())
      return
    }
    const timer = window.setTimeout(() => setNow(Date.now()), remaining)
    return () => window.clearTimeout(timer)
  }, [session.interaction])

  const run = useCallback(
    async (tier: DoctorRunTier) => {
      const feedbackMs = autoRunPolicy === 'when-not-running' ? EMBEDDED_RUN_FEEDBACK_MS : 0
      dispatch({
        type: 'start-interaction',
        interaction: { kind: 'run', tier, pendingUntil: feedbackMs > 0 ? Date.now() + feedbackMs : 0 }
      })
      try {
        await Promise.all([
          ipcApi.request('diagnostics.doctor.run', { tier }),
          feedbackMs > 0 ? new Promise((resolve) => window.setTimeout(resolve, feedbackMs)) : Promise.resolve()
        ])
      } catch (error) {
        logger.error('Failed to run system diagnostics', error as Error)
        toast.error(t('settings.doctor.messages.run_failed'))
      } finally {
        dispatch({ type: 'finish-interaction', kind: 'run' })
      }
    },
    [autoRunPolicy, t]
  )

  useEffect(() => {
    if (!sharedCacheReady || autoRunRequestedRef.current) return
    if (doctorState.status === 'running') {
      autoRunRequestedRef.current = true
      return
    }
    const shouldAutoRun = doctorState.status === 'idle' || autoRunPolicy === 'when-not-running'
    if (!shouldAutoRun) return
    autoRunRequestedRef.current = true
    void run('quick')
  }, [autoRunPolicy, doctorState.status, run, sharedCacheReady])

  const cancel = useCallback(async () => {
    if (doctorState.status !== 'running' || doctorState.tier !== 'live') return
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
          const fix = fixRequestFor(runId, checkId, action)
          if (!fix) return
          if (fix.meta.risk === 'confirm') {
            dispatch({ type: 'confirm-fix', request: fix.request })
            return
          }
          await performFix(fix.request)
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
        case 'open_cherry_account':
          dispatch({ type: 'start-interaction', interaction: { kind: 'action', actionKind: action.kind, checkId } })
          try {
            await ipcApi.request('cherry_cloud.login.start')
          } catch (error) {
            logger.error('Failed to start Cherry account login', error as Error)
            toast.error(t('settings.doctor.messages.account_failed'))
          } finally {
            dispatch({ type: 'finish-interaction', kind: 'action' })
          }
          return
        case 'install_update':
          if (appUpdateState.downloaded && appUpdateState.info) onInstallUpdate(appUpdateState.info)
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
    [
      appUpdateState.downloaded,
      appUpdateState.info,
      onInstallUpdate,
      onNavigate,
      onReportProblem,
      performFix,
      session.descriptionDraft,
      t,
      viewModel.isStale
    ]
  )

  const confirmFix = useCallback(async () => {
    if (session.interaction.kind !== 'confirm-fix') return
    await performFix(session.interaction.request)
  }, [performFix, session.interaction])

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

  const mcpServerName = useCallback(
    (target: string | undefined) => (target ? mcpServers.find((server) => server.id === target)?.name : undefined),
    [mcpServers]
  )

  return {
    appUpdateState,
    cancel,
    canChangePanel,
    cancelFixConfirmation: () => dispatch({ type: 'cancel-confirmation' }),
    confirmEvidence,
    confirmFix,
    executeAction,
    isInteracting,
    isCloseBlocked,
    mcpServerName,
    openLogsPath,
    openPath,
    run,
    session,
    setDescription: (description: string) => dispatch({ type: 'set-description', description }),
    setExpandedDomains: (domains: readonly (typeof session.expandedDomains)[number][]) =>
      dispatch({ type: 'set-expanded-domains', domains }),
    setPanel,
    setPanelInteraction,
    toggleDevTools,
    requestEvidence: (checkId: DoctorCheckId) => dispatch({ type: 'confirm-evidence', checkId }),
    viewModel
  }
}

export type DoctorController = ReturnType<typeof useDoctorController>
export type { DoctorInteraction, DoctorPanel }
