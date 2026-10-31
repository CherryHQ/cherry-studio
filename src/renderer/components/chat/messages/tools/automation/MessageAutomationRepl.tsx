import { Braces, Check, ChevronRight, Copy, RotateCcw } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import CodeViewer from '@renderer/components/CodeViewer'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import { getEffectiveStatus, ToolStatusIndicator } from '../shared/GenericTools'
import { ToolApprovalOutcome } from '../shared/ToolApprovalOutcome'
import { ToolDisclosure } from '../shared/ToolDisclosure'
import type { ToolResponseLike } from '../toolResponse'
import { formatAutomationReplOutput, getAutomationReplKind, parseAutomationReplOutput } from './automationRepl'

export const MessageAutomationRepl = memo(({ toolResponse }: { toolResponse: ToolResponseLike }) => {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const { id, arguments: args, status, response, approval } = toolResponse
  const kind = getAutomationReplKind(toolResponse.tool) ?? 'execute'
  const code = args && typeof args === 'object' && 'code' in args && typeof args.code === 'string' ? args.code : ''
  const title =
    args && typeof args === 'object' && 'title' in args && typeof args.title === 'string' ? args.title.trim() : ''
  const result = useMemo(() => parseAutomationReplOutput(response), [response])
  const output = useMemo(() => formatAutomationReplOutput(result.text), [result.text])
  const hasError = status === 'error' || result.isError
  const Icon = kind === 'reset' ? RotateCcw : Braces

  if (approval?.approved === false) return <ToolApprovalOutcome approval={approval} />

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="automation-repl-tool">
      <ToolDisclosure
        variant="light"
        triggerClassName="group/repl"
        bodyClassName="max-h-none overflow-visible rounded-none border-l border-border-subtle bg-transparent py-0 pr-0"
        items={[
          {
            key: id,
            label: (
              <span className="flex min-w-0 items-center gap-2">
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">
                  {kind === 'reset'
                    ? t('message.tools.automation.reset')
                    : title || t('message.tools.automation.execute')}
                </span>
                {status === 'done' && !hasError ? (
                  <span className="text-muted-foreground">
                    <Check aria-hidden="true" className="size-3" />
                    <span className="sr-only">{t('common.completed')}</span>
                  </span>
                ) : (
                  <ToolStatusIndicator status={getEffectiveStatus(status, false)} hasError={hasError} />
                )}
                <ChevronRight
                  aria-hidden="true"
                  className="size-3 opacity-50 transition-transform group-aria-expanded/repl:rotate-90"
                />
              </span>
            ),
            children: (
              <div className="flex min-w-0 flex-col gap-3 pt-2">
                {code && (
                  <section className="overflow-hidden rounded-md border border-border-subtle">
                    <div className="flex items-center justify-between bg-background-subtle px-3 py-1 text-xs text-muted-foreground">
                      <span>{t('message.tools.sections.code')} · JavaScript</span>
                      {actions?.copyText && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('common.copy')}
                          onClick={() => {
                            void Promise.resolve(
                              actions.copyText?.(code, { successMessage: t('message.copied') })
                            ).catch(() => actions.notifyError?.(t('message.copy.failed')))
                          }}>
                          <Copy className="size-3.5" />
                        </Button>
                      )}
                    </div>
                    <CodeViewer value={code} language="javascript" maxHeight={240} expanded={false} />
                  </section>
                )}
                {output && (
                  <section className="min-w-0">
                    <div className="mb-1 text-xs text-muted-foreground">{t('message.tools.sections.output')}</div>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background-subtle p-3 font-mono text-xs text-foreground">
                      {output}
                    </pre>
                    {output !== result.text && (
                      <ToolDisclosure
                        variant="light"
                        items={[
                          {
                            key: `${id}-raw`,
                            label: t('message.tools.raw'),
                            children: (
                              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">
                                {result.text}
                              </pre>
                            )
                          }
                        ]}
                      />
                    )}
                  </section>
                )}
              </div>
            )
          }
        ]}
      />
    </div>
  )
})

MessageAutomationRepl.displayName = 'MessageAutomationRepl'
