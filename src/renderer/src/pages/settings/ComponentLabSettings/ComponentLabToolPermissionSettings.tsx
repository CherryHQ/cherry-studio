import { Button } from '@cherrystudio/ui'
import PermissionRequestComposer, {
  findLatestPendingPermissionRequest
} from '@renderer/components/chat/composer/variants/PermissionRequestComposer'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type DemoMode = 'builtin' | 'mcp'

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

function createDemoPartsByMessageId(mode: DemoMode, version: number): Record<string, CherryMessagePart[]> {
  const messageId = `component-lab-tool-permission-message-${mode}-${version}`
  const toolCallId = `component-lab-tool-permission-call-${mode}-${version}`
  const approvalId = `component-lab-tool-permission-approval-${mode}-${version}`

  if (mode === 'mcp') {
    return {
      [messageId]: [
        {
          type: 'dynamic-tool',
          toolName: 'mcp__docs__lookup_docs',
          toolCallId,
          state: 'approval-requested',
          input: { query: 'composer permission request' },
          approval: { id: approvalId },
          callProviderMetadata: {
            'claude-code': {
              rawInput: { query: 'composer permission request' },
              parentToolCallId: null
            }
          }
        } as unknown as CherryMessagePart
      ]
    }
  }

  return {
    [messageId]: [
      {
        type: 'tool-CustomTool',
        toolName: 'CustomTool',
        toolCallId,
        state: 'approval-requested',
        input: {
          command: 'pnpm exec vitest run src/renderer/src/components/chat/composer',
          description: 'Run focused composer tests'
        },
        approval: { id: approvalId },
        callProviderMetadata: {
          'claude-code': {
            rawInput: {
              command: 'pnpm exec vitest run src/renderer/src/components/chat/composer',
              description: 'Run focused composer tests'
            },
            parentToolCallId: null
          }
        }
      } as unknown as CherryMessagePart
    ]
  }
}

function requireDemoRequest(partsByMessageId: Record<string, CherryMessagePart[]>) {
  const request = findLatestPendingPermissionRequest(partsByMessageId)
  if (!request) {
    throw new Error('Component Lab Tool Permission demo parts did not produce a pending request')
  }
  return request
}

const ComponentLabToolPermissionSettings: FC = () => {
  const { t } = useTranslation()
  const [mode, setMode] = useState<DemoMode>('builtin')
  const [previewVersion, setPreviewVersion] = useState(0)
  const [lastResponse, setLastResponse] = useState<unknown>()
  const partsByMessageId = useMemo(() => createDemoPartsByMessageId(mode, previewVersion), [mode, previewVersion])
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

  const selectMode = useCallback((nextMode: DemoMode) => {
    setMode(nextMode)
    setPreviewVersion((version) => version + 1)
    setLastResponse(undefined)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-foreground text-sm">{t('settings.componentLab.toolPermission.title')}</div>
          <div className="mt-1 text-muted-foreground text-xs">
            {t('settings.componentLab.toolPermission.description')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant={mode === 'builtin' ? 'default' : 'outline'} size="sm" onClick={() => selectMode('builtin')}>
            {t('settings.componentLab.toolPermission.builtinMode')}
          </Button>
          <Button variant={mode === 'mcp' ? 'default' : 'outline'} size="sm" onClick={() => selectMode('mcp')}>
            {t('settings.componentLab.toolPermission.mcpMode')}
          </Button>
          <Button variant="outline" size="sm" onClick={resetPreview}>
            {t('settings.componentLab.toolPermission.resetPreview')}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-border-subtle bg-muted/20">
        <div className="flex h-[360px] min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden px-[18px] py-4">
            <div className="h-9 w-56 rounded-[14px] bg-background/80" aria-hidden="true" />
          </div>
          <PermissionRequestComposer key={request.approvalId} request={request} onRespond={handleRespond} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DebugPanel
          title={t('settings.componentLab.toolPermission.currentRequest')}
          value={formatSnapshot({ partsByMessageId })}
        />
        <DebugPanel
          title={t('settings.componentLab.toolPermission.latestResponse')}
          value={lastResponse ? formatSnapshot(lastResponse) : t('settings.componentLab.toolPermission.noResponse')}
        />
      </div>
    </div>
  )
}

export default ComponentLabToolPermissionSettings
