import { Button, Tooltip } from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { Check } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import { AgentToolsType, type ToolRendererProps } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader, useIsStreaming } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'

const CodeViewer = lazy(() => import('@renderer/components/CodeViewer'))

function WorkflowDetail({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null

  return (
    <div className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="selectable truncate font-mono text-foreground" title={value}>
        {value}
      </span>
    </div>
  )
}

export function WorkflowTool({ input, output }: ToolRendererProps<typeof AgentToolsType.Workflow>): ToolDisclosureItem {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const [copied, setCopied] = useTemporaryValue(false)
  const isStreaming = useIsStreaming()
  const result = output && typeof output !== 'string' ? output : undefined
  // The tool always launches in the background and returns a receipt, so the run's identity comes
  // from the result: `workflowName` mirrors the script's `meta.name`. `input.description` / `title`
  // are documented as ignored by the SDK, so they are deliberately not used as a label.
  const name = result?.workflowName ?? input?.name
  const target = name ?? (result?.taskId ? t('message.tools.activity.taskId', { id: result.taskId }) : undefined)
  const script = input?.script
  const hasDetails = Boolean(
    script || result?.summary || result?.warning || result?.error || result?.runId || result?.scriptPath
  )
  const copyScript = () => {
    if (!script || !actions?.copyText) return
    Promise.resolve(actions.copyText(script, { successMessage: t('common.copied') }))
      .then(() => setCopied(true))
      .catch(() => actions.notifyError?.(t('message.copy.failed')))
  }

  return {
    key: AgentToolsType.Workflow,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Workflow}
        args={input}
        params={<SkeletonValue value={target} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: hasDetails ? (
      <div className="flex min-w-0 flex-col gap-3">
        {script ? (
          <div className="min-w-0">
            <div className="mb-1 flex min-h-7 items-center justify-between gap-2">
              <span className="font-medium text-muted-foreground text-xs">{t('message.tools.workflow.script')}</span>
              {actions?.copyText ? (
                <Tooltip content={copied ? t('common.copied') : t('common.copy')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copied ? t('common.copied') : t('common.copy')}
                    onClick={copyScript}>
                    {copied ? <Check size={14} className="text-control-accent" /> : <CopyIcon size={14} />}
                  </Button>
                </Tooltip>
              ) : null}
            </div>
            <Suspense
              fallback={
                <pre className="max-h-72 overflow-auto rounded-md bg-background-subtle p-2 font-mono text-foreground text-xs">
                  {script}
                </pre>
              }>
              <CodeViewer
                value={script}
                language="javascript"
                expanded={false}
                maxHeight="18rem"
                wrapped={false}
                autoScrollToBottom={isStreaming}
                options={{ highlight: !isStreaming }}
              />
            </Suspense>
          </div>
        ) : null}

        {result?.summary ? (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.workflow.summary')}</div>
            <div className="whitespace-pre-wrap rounded-md bg-background-subtle p-2 text-foreground text-xs">
              {result.summary}
            </div>
          </div>
        ) : null}

        {result?.warning ? (
          <div className="rounded-md border border-warning-border bg-warning-subtle p-2 text-warning-subtle-foreground text-xs">
            {result.warning}
          </div>
        ) : null}
        {result?.error ? (
          <div className="rounded-md border border-error-border bg-error-subtle p-2 text-error-subtle-foreground text-xs">
            {result.error}
          </div>
        ) : null}

        {result?.runId || result?.scriptPath ? (
          <div className="space-y-1.5 rounded-md border border-border-subtle bg-background-subtle p-2">
            <WorkflowDetail label={t('message.tools.workflow.run_id')} value={result.runId} />
            <WorkflowDetail label={t('message.tools.workflow.script_path')} value={result.scriptPath} />
          </div>
        ) : null}
      </div>
    ) : undefined,
    classNames: {
      body: 'max-h-[32rem] px-3 py-2'
    }
  }
}
