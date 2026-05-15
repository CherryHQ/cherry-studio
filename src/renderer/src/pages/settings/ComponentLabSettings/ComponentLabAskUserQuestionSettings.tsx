import { Button } from '@cherrystudio/ui'
import { findLatestPendingAskUserQuestionRequest } from '@renderer/components/chat/composer/askUserQuestion'
import AskUserQuestionComposer from '@renderer/components/chat/composer/variants/AskUserQuestionComposer'
import type { AskUserQuestionToolInput } from '@renderer/components/chat/messages/tools/agent/types'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function formatSnapshot(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function DebugPanel({ title, value }: { title: string; value?: string }) {
  return (
    <div className="flex flex-col rounded-[12px] border border-border-subtle bg-background p-3">
      <div className="mb-2 font-medium text-foreground text-xs">{title}</div>
      <pre className="min-h-[96px] flex-1 overflow-x-auto rounded-[8px] border border-border-subtle bg-muted/30 px-3 py-2 font-mono text-muted-foreground text-xs leading-5">
        {value ?? '-'}
      </pre>
    </div>
  )
}

const demoInput: AskUserQuestionToolInput = {
  questions: [
    {
      question: '选择日志记录方案：',
      header: '日志',
      options: [
        { label: 'Winston', description: '功能全面，生态成熟' },
        { label: 'Pino', description: '高性能，JSON 原生' },
        { label: 'Bunyan', description: '结构化日志' }
      ],
      multiSelect: false
    },
    {
      question: '是否需要 JSON 格式输出？',
      header: '格式',
      options: [
        { label: '是', description: '便于日志采集' },
        { label: '否', description: '保持可读性' }
      ],
      multiSelect: false
    }
  ]
}

function createDemoPartsByMessageId(version: number): Record<string, CherryMessagePart[]> {
  const messageId = `component-lab-ask-user-question-message-${version}`
  const toolCallId = `component-lab-ask-user-question-call-${version}`
  const approvalId = `component-lab-ask-user-question-approval-${version}`

  return {
    [messageId]: [
      {
        type: 'text',
        text: 'I need a decision before continuing.'
      },
      {
        type: 'dynamic-tool',
        toolName: 'AskUserQuestion',
        toolCallId,
        state: 'approval-requested',
        input: demoInput,
        providerExecuted: true,
        callProviderMetadata: {
          'claude-code': {
            parentToolCallId: null
          }
        },
        approval: { id: approvalId }
      } as unknown as CherryMessagePart
    ]
  }
}

function requireDemoRequest(partsByMessageId: Record<string, CherryMessagePart[]>) {
  const request = findLatestPendingAskUserQuestionRequest(partsByMessageId)
  if (!request) {
    throw new Error('Component Lab AskUserQuestion demo parts did not produce a pending request')
  }
  return request
}

const ComponentLabAskUserQuestionSettings: FC = () => {
  const { t } = useTranslation()
  const [previewVersion, setPreviewVersion] = useState(0)
  const [lastResponse, setLastResponse] = useState<unknown>()
  const partsByMessageId = useMemo(() => createDemoPartsByMessageId(previewVersion), [previewVersion])
  const request = useMemo(() => requireDemoRequest(partsByMessageId), [partsByMessageId])

  const handleRespond = useCallback(async ({ match, approved, reason, updatedInput }: MessageToolApprovalInput) => {
    setLastResponse({
      approvalId: match.approvalId,
      toolCallId: match.toolCallId,
      approved,
      reason,
      updatedInput
    })
  }, [])

  const resetPreview = useCallback(() => {
    setPreviewVersion((version) => version + 1)
    setLastResponse(undefined)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-foreground text-sm">{t('settings.componentLab.askUserQuestion.title')}</div>
          <div className="mt-1 text-muted-foreground text-xs">
            {t('settings.componentLab.askUserQuestion.description')}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={resetPreview}>
          {t('settings.componentLab.askUserQuestion.resetPreview')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-border-subtle bg-muted/20">
        <div className="flex h-[360px] min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden px-[18px] py-4">
            <div className="h-9 w-56 rounded-[14px] bg-background/80" aria-hidden="true" />
          </div>
          <AskUserQuestionComposer key={request.approvalId} request={request} onRespond={handleRespond} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DebugPanel
          title={t('settings.componentLab.askUserQuestion.currentRequest')}
          value={formatSnapshot({ partsByMessageId })}
        />
        <DebugPanel
          title={t('settings.componentLab.askUserQuestion.latestResponse')}
          value={lastResponse ? formatSnapshot(lastResponse) : t('settings.componentLab.askUserQuestion.noResponse')}
        />
      </div>
    </div>
  )
}

export default ComponentLabAskUserQuestionSettings
