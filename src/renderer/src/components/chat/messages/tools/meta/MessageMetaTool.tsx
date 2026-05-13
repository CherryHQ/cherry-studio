import { CopyIcon } from '@renderer/components/Icons'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import type { NormalToolResponse } from '@renderer/types'
import { Check, CornerDownRight } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getEffectiveStatus, ToolStatusIndicator } from '../agent/GenericTools'
import { chooseTool } from '../chooseTool'
import { ArgKey, ArgsSection, ArgsSectionTitle, ArgsTable, ArgValue, formatArgValue } from '../shared/ArgsTable'
import { ToolDisclosure } from '../shared/ToolDisclosure'

export const META_TOOL_NAMES = ['tool_search', 'tool_inspect', 'tool_invoke', 'tool_exec'] as const
export type MetaToolName = (typeof META_TOOL_NAMES)[number]

export function isMetaToolName(name: string): name is MetaToolName {
  return (META_TOOL_NAMES as readonly string[]).includes(name)
}

interface Props {
  toolResponse: NormalToolResponse
}

const MessageMetaTool: FC<Props> = ({ toolResponse }) => {
  const { id, tool, status, response } = toolResponse
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const { t } = useTranslation()

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

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const payload = JSON.stringify({ args: toolResponse.arguments, response: toolResponse.response }, null, 2)
    void navigator.clipboard.writeText(payload)
    window.toast.success({ title: t('message.copied'), key: 'copy-meta-tool' })
    setCopied(true)
    setTimeoutTimer('copyMetaTool', () => setCopied(false), 2000)
  }

  const titleLabel = useTitleLabel(toolResponse)

  return (
    <Container>
      <CollapseShell
        activeKey={activeKeys}
        onActiveKeyChange={setActiveKeys}
        items={[
          {
            key: id,
            label: (
              <TitleRow>
                <TitleText>{titleLabel}</TitleText>
                <Trailing>
                  <ToolStatusIndicator status={getEffectiveStatus(status, false)} hasError={hasError} />
                  {(isDone || isError) && (
                    <CopyButton onClick={handleCopy} aria-label={t('common.copy')}>
                      {copied ? <Check size={14} color="var(--status-color-success)" /> : <CopyIcon size={14} />}
                    </CopyButton>
                  )}
                </Trailing>
              </TitleRow>
            ),
            children: <Body toolResponse={toolResponse} toolName={tool.name as MetaToolName} />
          }
        ]}
      />
    </Container>
  )
}

function useTitleLabel(toolResponse: NormalToolResponse): string {
  const { tool, arguments: args } = toolResponse
  const name = tool.name as MetaToolName
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
      return 'tool_exec'
  }
}

// ── Body dispatcher ────────────────────────────────────────────────

const Body: FC<{ toolResponse: NormalToolResponse; toolName: MetaToolName }> = ({ toolResponse, toolName }) => {
  switch (toolName) {
    case 'tool_search':
      return <ToolSearchBody toolResponse={toolResponse} />
    case 'tool_inspect':
      return <ToolInspectBody toolResponse={toolResponse} />
    case 'tool_invoke':
      return <ToolInvokeBody toolResponse={toolResponse} />
    case 'tool_exec':
      return <ToolExecBody toolResponse={toolResponse} />
  }
}

// ── tool_search ────────────────────────────────────────────────────

interface SearchOutput {
  matchedNamespaces?: Array<{
    namespace: string
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
  }>
}

/**
 * The model gets full descriptions + (optional) schemas in its tool result;
 * the UI only needs the names — descriptions are noisy for humans browsing
 * a multi-namespace match. Group by namespace, list names as chips.
 */
const ToolSearchBody: FC<{ toolResponse: NormalToolResponse }> = ({ toolResponse }) => {
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const out = (toolResponse.response ?? undefined) as SearchOutput | undefined
  const matchedNamespaces = out?.matchedNamespaces ?? []

  return (
    <BodyContainer>
      <ArgsBlock args={args} />
      {toolResponse.status === 'done' && matchedNamespaces.length === 0 && <Empty>No tools matched.</Empty>}
      {matchedNamespaces.map((group) => (
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

const ToolInspectBody: FC<{ toolResponse: NormalToolResponse }> = ({ toolResponse }) => {
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const jsDoc = typeof toolResponse.response === 'string' ? toolResponse.response : undefined
  return (
    <BodyContainer>
      <ArgsBlock args={args} />
      {jsDoc && (
        <ResponseBlock title="JSDoc">
          <CodeBlock>{jsDoc}</CodeBlock>
        </ResponseBlock>
      )}
    </BodyContainer>
  )
}

// ── tool_invoke ────────────────────────────────────────────────────

/**
 * Synthesise a NormalToolResponse for the inner tool the model called via
 * `tool_invoke`, then dispatch through `chooseTool` so the inner call gets
 * its proper card (MCP / kb / web / agent / generic-fallback). When the
 * inner tool has no registered card, fall back to a json args+response
 * block instead of leaving the row blank.
 */
const ToolInvokeBody: FC<{ toolResponse: NormalToolResponse }> = ({ toolResponse }) => {
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const innerName = typeof args?.name === 'string' ? args.name : undefined
  const innerParams = isRecord(args?.params) ? args.params : undefined

  if (!innerName) {
    return (
      <BodyContainer>
        <Empty>tool_invoke called without a tool name.</Empty>
      </BodyContainer>
    )
  }

  const inner: NormalToolResponse = {
    ...toolResponse,
    id: `${toolResponse.id}::inner`,
    tool: { ...toolResponse.tool, name: innerName },
    arguments: innerParams,
    response: toolResponse.response
  }

  const innerRendered = chooseTool(inner)

  return (
    <BodyContainer>
      <InnerHint>
        <CornerDownRight size={12} /> via <code>tool_invoke</code>
      </InnerHint>
      {innerRendered ?? <GenericInner toolResponse={inner} />}
    </BodyContainer>
  )
}

const GenericInner: FC<{ toolResponse: NormalToolResponse }> = ({ toolResponse }) => {
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const response = toolResponse.response
  return (
    <>
      <ArgsBlock args={args} />
      {response !== undefined && response !== null && (
        <ResponseBlock title="Response">
          <CodeBlock>{stringifyResponse(response)}</CodeBlock>
        </ResponseBlock>
      )}
    </>
  )
}

// ── tool_exec ──────────────────────────────────────────────────────

interface ExecOutput {
  result?: unknown
  logs?: string[]
  error?: string
  isError?: boolean
}

const ToolExecBody: FC<{ toolResponse: NormalToolResponse }> = ({ toolResponse }) => {
  const args = isRecord(toolResponse.arguments) ? toolResponse.arguments : undefined
  const code = typeof args?.code === 'string' ? args.code : ''
  const out = (toolResponse.response ?? undefined) as ExecOutput | undefined

  const { highlightCode } = useCodeStyle()
  const [highlighted, setHighlighted] = useState<string>('')

  useEffect(() => {
    if (!code) return
    let cancelled = false
    void highlightCode(code, 'javascript').then((html) => {
      if (!cancelled) setHighlighted(html)
    })
    return () => {
      cancelled = true
    }
  }, [code, highlightCode])

  return (
    <BodyContainer>
      <ResponseBlock title="Code">
        {highlighted ? (
          <Highlighted className="markdown" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <CodeBlock>{code}</CodeBlock>
        )}
      </ResponseBlock>
      {out?.logs && out.logs.length > 0 && (
        <ResponseBlock title={`Logs (${out.logs.length})`}>
          <CodeBlock>{out.logs.join('\n')}</CodeBlock>
        </ResponseBlock>
      )}
      {out?.error && (
        <ResponseBlock title="Error">
          <CodeBlock data-error>{out.error}</CodeBlock>
        </ResponseBlock>
      )}
      {!out?.isError && out?.result !== undefined && (
        <ResponseBlock title="Result">
          <CodeBlock>{stringifyResponse(out.result)}</CodeBlock>
        </ResponseBlock>
      )}
    </BodyContainer>
  )
}

// ── Shared render helpers ──────────────────────────────────────────

const ArgsBlock: FC<{ args?: Record<string, unknown> }> = ({ args }) => {
  const entries = useMemo(() => (args ? Object.entries(args) : []), [args])
  if (entries.length === 0) return null
  return (
    <ArgsSection>
      <ArgsSectionTitle>Arguments</ArgsSectionTitle>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringifyResponse(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const Container = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['my-2.5', className].filter(Boolean).join(' ')} {...props} />
)

const CollapseShell = ({ className, ...props }: ComponentPropsWithoutRef<typeof ToolDisclosure>) => (
  <ToolDisclosure
    className={['overflow-hidden rounded-[7px] border border-border bg-background', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const TitleRow = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex w-full items-center justify-between gap-2.5', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const TitleText = ({ className, ...props }: ComponentPropsWithoutRef<'span'>) => (
  <span
    className={[
      'overflow-hidden text-ellipsis whitespace-nowrap font-[var(--font-family-mono,monospace)] font-medium text-[13px] text-foreground',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const Trailing = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['ml-auto flex items-center gap-1.5', className].filter(Boolean).join(' ')} {...props} />
)

const CopyButton = ({ className, ...props }: ComponentPropsWithoutRef<'button'>) => (
  <button
    type="button"
    className={[
      'flex cursor-pointer items-center rounded border-none bg-transparent p-1 text-foreground-secondary opacity-70 hover:bg-(--color-accent) hover:opacity-100',
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
      'inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-[var(--font-family-mono,monospace)] text-foreground text-xs',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const NamespaceTitle = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['text-foreground-secondary text-xs [&_small]:opacity-70', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const ResponseSectionStyled = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex flex-col gap-1', className].filter(Boolean).join(' ')} {...props} />
)

const CodeBlock = ({ className, ...props }: ComponentPropsWithoutRef<'pre'>) => (
  <pre
    className={[
      'm-0 max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-[var(--font-family-mono,monospace)] text-xs [&[data-error=true]]:text-[var(--status-color-error,#ff4d4f)]',
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

const InnerHint = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={[
      'flex items-center gap-1 text-[11px] text-foreground-muted [&_code]:font-[var(--font-family-mono,monospace)]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const Empty = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['text-foreground-muted text-xs italic', className].filter(Boolean).join(' ')} {...props} />
)

export default memo(MessageMetaTool)
