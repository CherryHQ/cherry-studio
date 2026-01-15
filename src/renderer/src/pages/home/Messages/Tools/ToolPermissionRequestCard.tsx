import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectPendingPermission, toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import { Button, Spin } from 'antd'
import { ChevronDown, CirclePlay, CircleX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ToolPermissionRequestCard')

interface Props {
  toolResponse: NormalToolResponse
}

export function ToolPermissionRequestCard({ toolResponse }: Props) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const request = useAppSelector((state) => selectPendingPermission(state.toolPermissions, toolResponse.toolCallId))
  const [now, setNow] = useState(() => Date.now())
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    if (!request) return

    logger.debug('Rendering inline tool permission card', {
      requestId: request.requestId,
      toolName: request.toolName,
      expiresAt: request.expiresAt
    })

    setNow(Date.now())

    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 500)

    return () => {
      window.clearInterval(interval)
    }
  }, [request])

  const remainingMs = useMemo(() => {
    if (!request) return 0
    return Math.max(0, request.expiresAt - now)
  }, [request, now])

  const remainingSeconds = useMemo(() => Math.ceil(remainingMs / 1000), [remainingMs])
  const isExpired = remainingMs <= 0

  const isSubmittingAllow = request?.status === 'submitting-allow'
  const isSubmittingDeny = request?.status === 'submitting-deny'
  const isSubmitting = isSubmittingAllow || isSubmittingDeny
  const isInvoking = request?.status === 'invoking'

  const handleDecision = useCallback(
    async (
      behavior: 'allow' | 'deny',
      extra?: {
        updatedInput?: Record<string, unknown>
        updatedPermissions?: PermissionUpdate[]
        message?: string
      }
    ) => {
      if (!request) return

      logger.debug('Submitting inline tool permission decision', {
        requestId: request.requestId,
        toolName: request.toolName,
        behavior
      })

      dispatch(toolPermissionsActions.submissionSent({ requestId: request.requestId, behavior }))

      try {
        const payload = {
          requestId: request.requestId,
          behavior,
          ...(behavior === 'allow'
            ? {
                updatedInput: extra?.updatedInput ?? request.input,
                updatedPermissions: extra?.updatedPermissions
              }
            : {
                message: extra?.message ?? t('agent.toolPermission.defaultDenyMessage')
              })
        }

        const response = await window.api.agentTools.respondToPermission(payload)

        if (!response?.success) {
          throw new Error('Renderer response rejected by main process')
        }

        logger.debug('Tool permission decision acknowledged by main process', {
          requestId: request.requestId,
          behavior
        })
      } catch (error) {
        logger.error('Failed to send tool permission response', error as Error)
        window.toast?.error?.(t('agent.toolPermission.error.sendFailed'))
        dispatch(toolPermissionsActions.submissionFailed({ requestId: request.requestId }))
      }
    },
    [dispatch, request, t]
  )

  if (!request) {
    return (
      <div className="rounded-xl border border-default-200 bg-default-100 px-4 py-3 text-default-500 text-sm">
        {t('agent.toolPermission.waiting')}
      </div>
    )
  }

  if (isInvoking) {
    return (
      <div className="w-full max-w-xl rounded-xl border border-default-200 bg-default-100 px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Spin size="small" />
              <div className="flex flex-col gap-1">
                <div className="font-semibold text-default-700 text-sm">{request.toolName}</div>
                <div className="text-default-500 text-xs">{t('agent.toolPermission.executing')}</div>
              </div>
            </div>
            {request.inputPreview && (
              <div className="flex items-center justify-end">
                <Button
                  aria-label={
                    showDetails
                      ? t('agent.toolPermission.aria.hideDetails')
                      : t('agent.toolPermission.aria.showDetails')
                  }
                  className="h-8 text-default-600 transition-colors hover:bg-default-200/50 hover:text-default-800"
                  onClick={() => setShowDetails((value) => !value)}
                  icon={<ChevronDown className={`transition-transform ${showDetails ? 'rotate-180' : ''}`} size={16} />}
                  variant="text"
                  style={{ backgroundColor: 'transparent' }}
                />
              </div>
            )}
          </div>

          {showDetails && request.inputPreview && (
            <div className="flex flex-col gap-3 border-default-200 border-t pt-3">
              <div className="rounded-md border border-default-200 bg-default-100 p-3">
                <p className="mb-2 font-medium text-default-400 text-xs uppercase tracking-wide">
                  {t('agent.toolPermission.inputPreview')}
                </p>
                <div className="max-h-[192px] overflow-auto font-mono text-xs">
                  <pre className="whitespace-pre-wrap break-all p-2 text-left">{request.inputPreview}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-xl rounded-xl border border-default-200 bg-default-100 px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="font-semibold text-default-700 text-sm">{request.toolName}</div>
            <div className="text-default-500 text-xs">
              {request.description?.trim() || t('agent.toolPermission.defaultDescription')}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              className={`rounded px-2 py-0.5 font-medium text-xs ${
                isExpired ? 'text-[var(--color-error)]' : 'text-[var(--color-status-warning)]'
              }`}>
              {isExpired
                ? t('agent.toolPermission.expired')
                : t('agent.toolPermission.pending', { seconds: remainingSeconds })}
            </div>

            <div className="flex items-center gap-1">
              <Button
                aria-label={t('agent.toolPermission.aria.denyRequest')}
                className="h-8"
                color="danger"
                disabled={isSubmitting || isExpired}
                loading={isSubmittingDeny}
                onClick={() => handleDecision('deny')}
                icon={<CircleX size={16} />}
                iconPosition={'start'}
                variant="outlined">
                {t('agent.toolPermission.button.cancel')}
              </Button>

              <Button
                aria-label={t('agent.toolPermission.aria.allowRequest')}
                className="h-8 px-3"
                color="primary"
                disabled={isSubmitting || isExpired}
                loading={isSubmittingAllow}
                onClick={() => handleDecision('allow')}
                icon={<CirclePlay size={16} />}
                iconPosition={'start'}
                variant="solid">
                {t('agent.toolPermission.button.run')}
              </Button>

              <Button
                aria-label={
                  showDetails ? t('agent.toolPermission.aria.hideDetails') : t('agent.toolPermission.aria.showDetails')
                }
                className="h-8 text-default-600 transition-colors hover:bg-default-200/50 hover:text-default-800"
                onClick={() => setShowDetails((value) => !value)}
                icon={<ChevronDown className={`transition-transform ${showDetails ? 'rotate-180' : ''}`} size={16} />}
                variant="text"
                style={{ backgroundColor: 'transparent' }}
              />
            </div>
          </div>
        </div>

        {showDetails && (
          <div className="flex flex-col gap-3 border-default-200 border-t pt-3">
            <div className="rounded-lg bg-default-200/60 px-3 py-2 text-default-600 text-sm">
              {t('agent.toolPermission.confirmation')}
            </div>

            <div className="rounded-md border border-default-200 bg-default-100 p-3">
              <p className="mb-2 font-medium text-default-400 text-xs uppercase tracking-wide">
                {t('agent.toolPermission.inputPreview')}
              </p>
              <div className="max-h-[192px] overflow-auto font-mono text-xs">
                <pre className="whitespace-pre-wrap break-all p-2 text-left">{request.inputPreview}</pre>
              </div>
            </div>

            {request.requiresPermissions && (
              <div className="rounded-md border border-warning-300 bg-warning-50 p-3 text-warning-700 text-xs">
                {t('agent.toolPermission.requiresElevatedPermissions')}
              </div>
            )}

            {request.suggestions.length > 0 && (
              <div className="rounded-md border border-default-200 bg-default-50 p-3 text-default-500 text-xs">
                {request.suggestions.length === 1
                  ? t('agent.toolPermission.suggestion.permissionUpdateSingle')
                  : t('agent.toolPermission.suggestion.permissionUpdateMultiple')}
              </div>
            )}
          </div>
        )}

        {isExpired && !isSubmitting && (
          <div className="text-center text-danger-500 text-xs">{t('agent.toolPermission.permissionExpired')}</div>
        )}
      </div>
    </div>
  )
}

export default ToolPermissionRequestCard
