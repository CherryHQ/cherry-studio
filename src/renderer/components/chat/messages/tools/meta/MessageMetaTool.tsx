import type { ComponentPropsWithoutRef, FC } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { useTimer } from '@renderer/hooks/useTimer'
import { safeToString } from '@renderer/utils/error'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import { ArgKey, ArgsSection, ArgsSectionTitle, ArgsTable, ArgValue, formatArgValue } from '../shared/ArgsTable'
import { getEffectiveStatus, ToolStatusIndicator } from '../shared/GenericTools'
import { ToolDisclosure } from '../shared/ToolDisclosure'
import type { ToolResponseLike } from '../toolResponse'
import type { MetaToolName } from './metaToolNames'

export { isMetaToolName, META_TOOL_NAMES, type MetaToolName } from './metaToolNames'

interface Props {
  toolResponse: ToolResponseLike
  toolName: MetaToolName
}

const MessageMetaTool: FC<Props> = ({ toolResponse, toolName }) => {
  const { id, status, response } = toolResponse
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const copyText = actions?.copyText
  const notifyError = actions?.notifyError

  const isStreaming = status === 'streaming'
  const isDone = status === 'done'
  const isError = status === 'error'
  const hasError = response?.isError === true

  // Auto-expand while the call is in flight; collapse once finished.
  useEffect(() => {
    if (isStreaming || status === 'invoking' || status === 'pending') {
      setActiveKeys((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } else if (isDone || isError) {
      setActiveKeys((prev) => prev.filter((k) => k !== id))
    }
  }, [isStreaming, isDone, isError, status, id])

  const titleLabel = useTitleLabel(toolResponse, toolName)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const payload = safeToString({ args: toolResponse.arguments, response: toolResponse.response }, 2)

    if (!copyText) return
    Promise.resolve(copyText(payload, { successMessage: t('message.copied') }))
      .then(() => {
        setCopied(true)
        setTimeoutTimer('copyMetaTool', () => setCopied(false), 2000)
      })
      .catch(() => {
        notifyError?.(t('message.copy.failed'))
      })
  }

  return (
    <Container>
      <CollapseShell
        activeKey={activeKeys}
        onActiveKeyChange={setActiveKeys}
        className="message-tools-container"
        items={[
          {
            key: id,
            label: (
              <MessageTitleLabel>
                <TitleContent>
                  <ToolName>{titleLabel}</ToolName>
                </TitleContent>
                <TitleActions>
                  <ToolStatusIndicator status={getEffectiveStatus(status, false)} hasError={hasError} />
                </TitleActions>
              </MessageTitleLabel>
            ),
            extra: (isDone || isError) && copyText && (
              <CopyButton
                className="message-action-button invisible opacity-0 transition-opacity duration-150 group-hover/tool:visible group-hover/tool:opacity-100 focus-visible:visible focus-visible:opacity-100"
                onClick={handleCopy}
                aria-label={t('common.copy')}>
                {copied ? t('common.copied') : t('common.copy')}
              </CopyButton>
            ),
            children: <Body toolResponse={toolResponse} toolName={toolName} />
          }
        ]}
      />
    </Container>
  )
}

function useTitleLabel(toolResponse: ToolResponseLike, name: MetaToolName): string {
  const { arguments: args } = toolResponse
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- Native, streamed and persisted arguments may be arrays or text; this guard verifies the envelope before each field is checked.
  const argRecord = isRecord(args) ? args : undefined

  switch (name) {
    case 'tool_search': {
      const q = typeof argRecord?.query === 'string' ? argRecord.query : undefined
      const ns = typeof argRecord?.namespace === 'string' ? argRecord.namespace : undefined
      const parts = [q && `"${q}"`, ns && `ns=${ns}`].filter(Boolean)

      return `tool_search${parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}`
    }

    case 'tool_inspect': {
      const targetName = typeof argRecord?.name === 'string' ? argRecord.name : '?'

      return `tool_inspect · ${targetName}`
    }

    case 'tool_invoke': {
      const targetName = typeof argRecord?.name === 'string' ? argRecord.name : '?'

      return `tool_invoke · ${targetName}`
    }

    case 'tool_exec':
    case 'codemode':
      return name
  }
}

// ── Body dispatcher ────────────────────────────────────────────────

const Body: FC<{ toolResponse: ToolResponseLike; toolName: MetaToolName }> = ({ toolResponse, toolName }) => {
  switch (toolName) {
    case 'tool_search':
      return <ToolSearchBody toolResponse={toolResponse} />
    case 'tool_inspect':
      return <ToolInspectBody toolResponse={toolResponse} />
    case 'tool_invoke':
      return <ToolInvokeBody toolResponse={toolResponse} />
    case 'tool_exec':
    case 'codemode':
      return <ToolExecBody toolResponse={toolResponse} />
  }
}

// ── tool_search ────────────────────────────────────────────────────

const searchNamespacesSchema = z.array(
  z.object({ namespace: z.string(), tools: z.array(z.object({ name: z.string() })) })
)
const stringListSchema = z.array(z.string())

/**
 * The model gets full descriptions + (optional) schemas in its tool result;
 * the UI only needs the names — descriptions are noisy for humans browsing
 * a multi-namespace match. Group by namespace, list names as chips.
 */
const ToolSearchBody: FC<{ toolResponse: ToolResponseLike }> = ({ toolResponse }) => {
  const { t } = useTranslation()
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const out = isRecord(toolResponse.response) ? toolResponse.response : undefined
  const namespaces = searchNamespacesSchema.safeParse(out?.matchedNamespaces)
  const loaded = stringListSchema.safeParse(out?.loaded)

  let matchedNamespaces = namespaces.success ? namespaces.data : undefined

  if (out?.matchedNamespaces == null && loaded.success) {
    matchedNamespaces = loaded.data.length ? [{ namespace: 'pi', tools: loaded.data.map((name) => ({ name })) }] : []
  }

  return (
    <BodyContainer>
      <ArgsBlock args={args} />
      {toolResponse.status === 'done' && matchedNamespaces?.length === 0 && (
        <Empty>{t('message.tools.meta.no_tools_matched')}</Empty>
      )}
      {matchedNamespaces === undefined && toolResponse.response != null && (
        <ResponseBlock title={t('message.tools.sections.output')}>
          <CodeBlock>{stringifyResponse(toolResponse.response)}</CodeBlock>
        </ResponseBlock>
      )}
      {matchedNamespaces?.map((group) => (
        <NamespaceGroup key={group.namespace}>
          <NamespaceTitle>
            <code>{group.namespace}</code> <small>({group.tools.length})</small>
          </NamespaceTitle>
          <ToolNameList>
            {group.tools.map((tool) => (
              <ToolNameChip key={tool.name}>{tool.name}</ToolNameChip>
            ))}
          </ToolNameList>
        </NamespaceGroup>
      ))}
    </BodyContainer>
  )
}

// ── tool_inspect ───────────────────────────────────────────────────

const ToolInspectBody: FC<{ toolResponse: ToolResponseLike }> = ({ toolResponse }) => {
  const { t } = useTranslation()
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const jsDoc = typeof toolResponse.response === 'string' ? toolResponse.response : undefined

  return (
    <BodyContainer>
      <ArgsBlock args={args} />
      {jsDoc && (
        <ResponseBlock title={t('message.tools.sections.jsdoc')}>
          <CodeBlock>{jsDoc}</CodeBlock>
        </ResponseBlock>
      )}
    </BodyContainer>
  )
}

// ── tool_invoke ────────────────────────────────────────────────────

/**
 * `tool_invoke` wraps an inner tool call (`{ name, params }`). The outer card
 * header already names the inner tool (`tool_invoke · <name>`), so the body
 * shows the call's input + output flat — not a second nested collapsible card,
 * which duplicated the name/status and buried the params an extra expand deep.
 */
const ToolInvokeBody: FC<{ toolResponse: ToolResponseLike }> = ({ toolResponse }) => {
  const { t } = useTranslation()
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const innerName = typeof args?.name === 'string' ? args.name : undefined
  const innerParams = isRecord(args?.params) ? args.params : undefined
  const response = toolResponse.response

  if (!innerName) {
    return (
      <BodyContainer>
        <Empty>{t('message.tools.meta.invoke_missing_name')}</Empty>
      </BodyContainer>
    )
  }

  return (
    <BodyContainer>
      <ArgsBlock args={innerParams} />
      {response !== undefined && response !== null && (
        <ResponseBlock title={t('message.tools.sections.output')}>
          <CodeBlock>{stringifyResponse(response)}</CodeBlock>
        </ResponseBlock>
      )}
    </BodyContainer>
  )
}

// ── tool_exec ──────────────────────────────────────────────────────

const ToolExecBody: FC<{ toolResponse: ToolResponseLike }> = ({ toolResponse }) => {
  const { t } = useTranslation()
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const code = typeof args?.code === 'string' ? args.code : ''

  const out =
    typeof toolResponse.response === 'string'
      ? { result: toolResponse.response }
      : isRecord(toolResponse.response)
        ? toolResponse.response
        : undefined
  const logs = stringListSchema.safeParse(out && 'logs' in out ? out.logs : undefined)
  const error = out && 'error' in out ? out.error : undefined
  const result = out?.result
  const isError = out && 'isError' in out ? out.isError : undefined
  const showRawResponse =
    toolResponse.response != null &&
    (!out ||
      (!('result' in out) && !('logs' in out) && !('error' in out)) ||
      ('logs' in out && out.logs != null && !logs.success) ||
      (error != null && typeof error !== 'string') ||
      (isError != null && typeof isError !== 'boolean'))

  const { highlightCode } = useCodeStyle()
  const [highlighted, setHighlighted] = useState<string>('')

  // Tracks the inputs of the last completed highlight so an <Activity> re-show
  // (which re-runs this effect with unchanged inputs) skips the shiki pass.
  const highlightedForRef = useRef<{ code: string; highlight: typeof highlightCode } | null>(null)
  useEffect(() => {
    if (!code) return
    const last = highlightedForRef.current

    if (last && last.code === code && last.highlight === highlightCode) return
    let cancelled = false
    void highlightCode(code, 'javascript').then((html) => {
      if (cancelled) return
      highlightedForRef.current = { code, highlight: highlightCode }
      setHighlighted(html)
    })

    return () => {
      cancelled = true
    }
  }, [code, highlightCode])

  return (
    <BodyContainer>
      <ResponseBlock title={t('message.tools.sections.code')}>
        {highlighted ? (
          <Highlighted className="markdown" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <CodeBlock>{code}</CodeBlock>
        )}
      </ResponseBlock>
      {logs.success && logs.data.length > 0 && (
        <ResponseBlock title={t('message.tools.sections.logs', { count: logs.data.length })}>
          <CodeBlock>{logs.data.join('\n')}</CodeBlock>
        </ResponseBlock>
      )}
      {typeof error === 'string' && error && (
        <ResponseBlock title={t('message.tools.status.error')}>
          <CodeBlock data-error>{error}</CodeBlock>
        </ResponseBlock>
      )}
      {!isError && result !== undefined && (
        <ResponseBlock title={t('message.tools.sections.output')}>
          <CodeBlock>{stringifyResponse(result)}</CodeBlock>
        </ResponseBlock>
      )}
      {showRawResponse && (
        <ResponseBlock title={t('message.tools.sections.output')}>
          <CodeBlock>{stringifyResponse(toolResponse.response)}</CodeBlock>
        </ResponseBlock>
      )}
    </BodyContainer>
  )
}

// ── Shared render helpers ──────────────────────────────────────────

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Native and extension arguments have no shared value schema; formatArgValue safely formats each raw entry for display.
const ArgsBlock: FC<{ args?: Record<string, unknown> }> = ({ args }) => {
  const { t } = useTranslation()
  const entries = useMemo(() => (args ? Object.entries(args) : []), [args])

  if (entries.length === 0) return null

  return (
    <ArgsSection>
      <ArgsSectionTitle>{t('message.tools.sections.args')}</ArgsSectionTitle>
      <ArgsTable>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <ArgKey>{k}</ArgKey>
              <ArgValue>{formatArgValue(v)}</ArgValue>
            </tr>
          ))}
        </tbody>
      </ArgsTable>
    </ArgsSection>
  )
}

const ResponseBlock: FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <ResponseSectionStyled>
    <ArgsSectionTitle>{title}</ArgsSectionTitle>
    {children}
  </ResponseSectionStyled>
)

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Meta-tool envelopes and inner arguments retain native values; field readers check strings and argument tables use safeToString.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native and extension tool results have heterogeneous payloads; render them without trusting serialization hooks.
function stringifyResponse(value: unknown): string {
  return safeToString(value, 2)
}

const Container = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['group/tool my-px first:mt-0 first:pt-0', className].filter(Boolean).join(' ')} {...props} />
)

const CollapseShell = ({ className, ...props }: ComponentPropsWithoutRef<typeof ToolDisclosure>) => (
  <ToolDisclosure
    variant="light"
    className={[
      'border-none [--status-color-error:var(--muted-foreground)] [--status-color-invoking:var(--primary)] [--status-color-success:var(--primary)] [--status-color-warning:var(--warning)]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const MessageTitleLabel = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex w-full flex-row items-center justify-between gap-2 p-0', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const TitleContent = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex min-w-0 flex-1 flex-row items-center gap-1.5 leading-5', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const ToolName = ({ className, ...props }: ComponentPropsWithoutRef<'span'>) => (
  <span
    className={[
      'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-[13px] text-muted-foreground transition-colors duration-150 group-hover/tool:text-foreground',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const TitleActions = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex shrink-0 items-center gap-1.5', className].filter(Boolean).join(' ')} {...props} />
)

const CopyButton = ({ className, type = 'button', ...props }: ComponentPropsWithoutRef<'button'>) => (
  <button
    type={type}
    className={[
      'flex h-5 cursor-pointer items-center justify-center rounded border-none bg-transparent px-1 text-[11px] text-muted-foreground opacity-70 transition-all duration-200 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:bg-accent focus-visible:text-foreground focus-visible:opacity-100 focus-visible:outline-none',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const BodyContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex flex-col gap-2.5', className].filter(Boolean).join(' ')} {...props} />
)

const NamespaceGroup = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')} {...props} />
)

const ToolNameList = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex flex-wrap gap-1', className].filter(Boolean).join(' ')} {...props} />
)

const ToolNameChip = ({ className, ...props }: ComponentPropsWithoutRef<'code'>) => (
  <code
    className={[
      'font-(family-name:--code-font-family) inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-foreground text-xs',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const NamespaceTitle = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['text-muted-foreground text-xs [&_small]:opacity-70', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const ResponseSectionStyled = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex flex-col gap-1', className].filter(Boolean).join(' ')} {...props} />
)

const CodeBlock = ({ className, ...props }: ComponentPropsWithoutRef<'pre'>) => (
  <pre
    className={[
      'wrap-break-word font-(family-name:--code-font-family) m-0 max-h-[300px] overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs data-[error=true]:text-(--status-color-error)',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const Highlighted = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={[
      '[&_pre]:max-h-[300px] [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted! [&_pre]:p-2 [&_pre]:text-xs',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const Empty = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['text-foreground-tertiary text-xs italic', className].filter(Boolean).join(' ')} {...props} />
)

export default memo(MessageMetaTool)
