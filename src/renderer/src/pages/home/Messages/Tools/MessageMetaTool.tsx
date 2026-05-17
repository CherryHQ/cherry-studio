import { CopyIcon } from '@renderer/components/Icons'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import type { NormalToolResponse } from '@renderer/types'
import { Collapse } from 'antd'
import { Check, ChevronRight, CornerDownRight } from 'lucide-react'
import type { FC } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { chooseTool } from './chooseTool'
import { getEffectiveStatus, ToolStatusIndicator } from './MessageAgentTools/GenericTools'
import { ArgKey, ArgsSection, ArgsSectionTitle, ArgsTable, ArgValue, formatArgValue } from './shared/ArgsTable'

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
        ghost
        size="small"
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : [keys])}
        expandIconPosition="end"
        expandIcon={({ isActive }) => (
          <ExpandIcon $isActive={isActive} size={18} color="var(--color-text-3)" strokeWidth={1.5} />
        )}
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

// ── Styled ─────────────────────────────────────────────────────────

const Container = styled.div`
  margin-top: 10px;
  margin-bottom: 10px;
`

const CollapseShell = styled(Collapse)`
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background-color: var(--color-background);
  overflow: hidden;

  .ant-collapse-header {
    padding: 8px 10px !important;
    align-items: center !important;
  }
  .ant-collapse-content-box {
    padding: 10px !important;
  }
`

const ExpandIcon = styled(ChevronRight)<{ $isActive?: boolean }>`
  transition: transform 0.2s;
  transform: ${({ $isActive }) => ($isActive ? 'rotate(90deg)' : 'rotate(0deg)')};
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 10px;
`

const TitleText = styled.span`
  color: var(--color-text);
  font-weight: 500;
  font-size: 13px;
  font-family: var(--font-family-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Trailing = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  margin-left: auto;
`

const CopyButton = styled.button`
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--color-text-2);
  opacity: 0.7;
  border-radius: 4px;
  display: flex;
  align-items: center;
  &:hover {
    opacity: 1;
    background: var(--color-bg-3);
  }
`

const BodyContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const NamespaceGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const ToolNameList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

const ToolNameChip = styled.code`
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  font-family: var(--font-family-mono, monospace);
  font-size: 12px;
  color: var(--color-text);
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 4px;
`

const NamespaceTitle = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  small {
    opacity: 0.7;
  }
`

const ResponseSectionStyled = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const CodeBlock = styled.pre`
  margin: 0;
  padding: 8px;
  font-family: var(--font-family-mono, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-background-soft);
  border-radius: 4px;
  overflow: auto;
  max-height: 300px;

  &[data-error='true'] {
    color: var(--status-color-error, #ff4d4f);
  }
`

const Highlighted = styled.div`
  & pre {
    background: var(--color-background-soft) !important;
    padding: 8px;
    border-radius: 4px;
    overflow: auto;
    max-height: 300px;
    font-size: 12px;
  }
`

const InnerHint = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-3);
  code {
    font-family: var(--font-family-mono, monospace);
  }
`

const Empty = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  font-style: italic;
`

export default memo(MessageMetaTool)
