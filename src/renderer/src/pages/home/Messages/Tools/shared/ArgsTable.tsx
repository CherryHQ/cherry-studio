import styled from 'styled-components'

import { SkeletonSpan } from '../MessageAgentTools/GenericTools'

/**
 * Format argument value for display in table
 */
export const formatArgValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * Shared argument table component for displaying tool parameters
 * Used by both MCP tools and Agent tools
 */
export function ToolArgsTable({
  args,
  title,
  isStreaming = false
}: {
  args: Record<string, unknown> | unknown[] | null | undefined
  title?: string
  isStreaming?: boolean
}) {
  if (!args) return null

  // Handle both object and array args
  const entries: Array<[string, unknown]> = Array.isArray(args) ? [['arguments', args]] : Object.entries(args)

  if (entries.length === 0 && !isStreaming) return null

  return (
    <ArgsSection>
      {title && <ArgsSectionTitle>{title}</ArgsSectionTitle>}
      <ArgsTable>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <ArgKey>{key}</ArgKey>
              <ArgValue>{formatArgValue(value)}</ArgValue>
            </tr>
          ))}
          {isStreaming && (
            <tr>
              <ArgKey>
                <SkeletonSpan width="60px" />
              </ArgKey>
              <ArgValue>
                <SkeletonSpan width="120px" />
              </ArgValue>
            </tr>
          )}
        </tbody>
      </ArgsTable>
    </ArgsSection>
  )
}

// Styled components extracted from MessageMcpTool

export const ArgsSection = styled.div`
  padding: 8px 12px;
  font-family: var(--font-family-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
`

export const ArgsSectionTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-3);
  text-transform: uppercase;
  margin-bottom: 8px;
`

export const ArgsTable = styled.table`
  width: 100%;
  border-collapse: collapse;
`

export const ArgKey = styled.td`
  color: var(--color-primary);
  padding: 4px 8px 4px 0;
  white-space: nowrap;
  vertical-align: top;
  font-weight: 500;
  width: 1%;
`

export const ArgValue = styled.td`
  color: var(--color-text);
  padding: 4px 0;
  word-break: break-all;
  white-space: pre-wrap;
`

export const ResponseSection = styled.div`
  padding: 8px 12px;
  border-top: 1px solid var(--color-border);
`
