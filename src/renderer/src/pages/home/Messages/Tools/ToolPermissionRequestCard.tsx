import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectPendingPermission, toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import type { CollapseProps } from 'antd'
import { Button, Collapse, Spin } from 'antd'
import { CirclePlay, CircleX, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { StreamingContext } from './MessageAgentTools/GenericTools'
import { isValidAgentToolsType, renderTool } from './MessageAgentTools/index'
import { UnknownToolRenderer } from './MessageAgentTools/UnknownToolRenderer'

const logger = loggerService.withContext('ToolPermissionRequestCard')

interface Props {
  toolResponse: NormalToolResponse
}

export function ToolPermissionRequestCard({ toolResponse }: Props) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const request = useAppSelector((state) => selectPendingPermission(state.toolPermissions, toolResponse.toolCallId))
  const [now, setNow] = useState(() => Date.now())

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

  // Render tool content based on tool type
  const renderToolContent = useCallback(() => {
    if (!request) return null

    const toolName = request.toolName
    const input = request.input

    if (isValidAgentToolsType(toolName)) {
      // Known tool type: use specialized renderer with type-safe function
      const renderedItem = renderTool(toolName, input)

      const toolContentItem: NonNullable<CollapseProps['items']>[number] = {
        ...renderedItem,
        classNames: {
          body: 'bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100 max-h-60 overflow-auto'
        }
      }

      return (
        <StreamingContext value={false}>
          <Collapse
            className="w-full"
            expandIconPosition="end"
            size="small"
            defaultActiveKey={[String(renderedItem.key ?? toolName)]}
            items={[toolContentItem]}
          />
        </StreamingContext>
      )
    }

    // Unknown tool type: use argument table fallback
    const renderedItem = UnknownToolRenderer({ input, toolName })
    const toolContentItem: NonNullable<CollapseProps['items']>[number] = {
      ...renderedItem,
      classNames: {
        body: 'bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100 max-h-60 overflow-auto'
      }
    }

    return (
      <StreamingContext value={false}>
        <Collapse
          className="w-full"
          expandIconPosition="end"
          size="small"
          defaultActiveKey={[String(renderedItem.key ?? 'unknown')]}
          items={[toolContentItem]}
        />
      </StreamingContext>
    )
  }, [request])

  if (!request) {
    return (
      <div className="rounded-xl border border-default-200 bg-default-100 px-4 py-3 text-default-500 text-sm">
        {t('agent.toolPermission.waiting')}
      </div>
    )
  }

  if (isInvoking) {
    return (
      <Container>
        <div className="flex items-center gap-3 px-3 py-2">
          <Spin size="small" />
          <div className="flex flex-col gap-1">
            <div className="font-semibold text-default-700 text-sm">{request.toolName}</div>
            <div className="text-default-500 text-xs">{t('agent.toolPermission.executing')}</div>
          </div>
        </div>
        {renderToolContent()}
      </Container>
    )
  }

  return (
    <Container>
      {/* Tool content area */}
      {renderToolContent()}

      {/* Bottom action bar */}
      <ActionsBar>
        <div className="flex items-center gap-2">
          <StatusBadge $isExpired={isExpired}>
            {isExpired
              ? t('agent.toolPermission.expired')
              : t('agent.toolPermission.pending', { seconds: remainingSeconds })}
          </StatusBadge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            aria-label={t('agent.toolPermission.aria.denyRequest')}
            size="small"
            color="danger"
            disabled={isSubmitting || isExpired}
            loading={isSubmittingDeny}
            onClick={() => handleDecision('deny')}
            icon={<CircleX size={14} />}
            variant="outlined">
            {t('agent.toolPermission.button.cancel')}
          </Button>

          <Button
            aria-label={t('agent.toolPermission.aria.allowRequest')}
            size="small"
            color="primary"
            disabled={isSubmitting || isExpired}
            loading={isSubmittingAllow}
            onClick={() => handleDecision('allow')}
            icon={<CirclePlay size={14} />}
            variant="solid">
            {t('agent.toolPermission.button.run')}
          </Button>

          {request.suggestions.length > 0 && (
            <Button
              aria-label={t('agent.toolPermission.aria.allowAllRequest')}
              size="small"
              color="primary"
              disabled={isSubmitting || isExpired}
              onClick={() => handleDecision('allow', { updatedPermissions: request.suggestions })}
              icon={<ShieldCheck size={14} />}
              variant="text">
              {t('agent.toolPermission.button.allowAll')}
            </Button>
          )}
        </div>
      </ActionsBar>

      {isExpired && !isSubmitting && (
        <div className="px-3 pb-2 text-center text-danger-500 text-xs">
          {t('agent.toolPermission.permissionExpired')}
        </div>
      )}
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  max-width: 36rem;
  border-radius: 0.75rem;
  border: 1px solid var(--color-border);
  background-color: var(--color-background-soft);
  overflow: hidden;

  .ant-collapse {
    border: none;
    border-radius: 0;
    background: transparent;
  }

  .ant-collapse-item {
    border: none;
  }

  .ant-collapse-header {
    padding: 8px 12px !important;
  }
`

const ActionsBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-top: 1px solid var(--color-border);
  background-color: var(--color-background);
`

const StatusBadge = styled.span<{ $isExpired: boolean }>`
  font-size: 12px;
  font-weight: 500;
  color: ${(props) => (props.$isExpired ? 'var(--color-error)' : 'var(--color-status-warning)')};
`

export default ToolPermissionRequestCard
