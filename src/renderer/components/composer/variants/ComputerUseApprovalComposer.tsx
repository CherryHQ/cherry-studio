import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ComputerUseAppIcon } from '@renderer/components/ComputerUseAppIcon'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { ComputerUseApprovalRequest, ComputerUseApprovalScope } from '@shared/ipc/schemas/computerUse'

import type { ComposerOverride } from '../ComposerContext'

const logger = loggerService.withContext('ComputerUseApprovalComposer')

export function useComputerUseApproval(topicId?: string): ComposerOverride | undefined {
  const { data, mutate } = useSWR(topicId ? ['computer-use-approvals', topicId] : null, () =>
    ipcApi.request('computer_use.get_approvals')
  )
  useIpcOn('computer_use.approvals_changed', () => void mutate())
  const request = data?.find((request) => request.topicId === topicId)
  if (!request) return undefined
  return {
    id: `computer-use:${request.approvalId}`,
    priority: 95,
    render: ({ className }) => (
      <ComputerUseApprovalComposer
        key={request.approvalId}
        request={request}
        className={className}
        onResponded={() => void mutate()}
      />
    )
  }
}

export function ComputerUseApprovalComposer({
  request,
  className,
  onResponded
}: {
  request: ComputerUseApprovalRequest
  className?: string
  onResponded: () => void
}) {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const respond = async (scope: ComputerUseApprovalScope) => {
    if (submitting) return
    setSubmitting(true)
    setFailed(false)
    try {
      const accepted = await ipcApi.request('computer_use.respond_approval', { approvalId: request.approvalId, scope })
      if (!accepted) throw new Error('Application approval is no longer pending')
      onResponded()
    } catch (error) {
      logger.warn('Application approval response failed', error as Error)
      setFailed(true)
      setSubmitting(false)
      onResponded()
    }
  }
  return (
    <div
      data-composer-viewport-inset-target=""
      className={cn(
        'pointer-events-auto rounded-xl border border-border bg-background p-3 text-foreground',
        className
      )}>
      <div className="flex items-center gap-2 font-medium text-sm">
        <ComputerUseAppIcon app={request.app} />
        {t('settings.computerUse.approval.prompt', { app: request.app.name })}
      </div>
      <p className="mt-1 break-all text-xs text-muted-foreground">{request.app.identity}</p>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-error">
          {t('agent.toolPermission.error.sendFailed')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={submitting} onClick={() => void respond('reject')}>
          {t('settings.computerUse.approval.reject')}
        </Button>
        <Button variant="secondary" disabled={submitting} onClick={() => void respond('session')}>
          {t('settings.computerUse.approval.session')}
        </Button>
        <Button disabled={submitting} onClick={() => void respond('always')}>
          {t('settings.computerUse.approval.always')}
        </Button>
      </div>
    </div>
  )
}
