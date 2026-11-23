import { CallToolResultSchema } from '@modelcontextprotocol/core'
import { useTranslation } from 'react-i18next'

import { getFilePreviewFileName } from '@renderer/utils/filePreview'
import { type ToMarkdownOutput, toMarkdownOutputSchema } from '@shared/ai/builtinTools'

import { TO_MARKDOWN_RUNTIME_TOOL_NAME } from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { SkeletonValue, ToolHeader } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Partial streamed arguments and historical tool inputs are unparsed; display a path only after checking its nonblank string field.
function readSourcePath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('path' in input)) return undefined
  const value = input.path

  return typeof value === 'string' && value.trim() ? value : undefined
}

/** The tool answers with a JSON receipt — the converted Markdown stays on disk, out of context. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Runtime and stored results first need MCP envelope validation; validate the JSON text against the tool-owned receipt schema before rendering statistics.
function parseReceipt(output: unknown): ToMarkdownOutput | null {
  const result = CallToolResultSchema.safeParse(output)

  if (!result.success || result.data.isError) return null

  const text = result.data.content.find((item) => item.type === 'text')?.text

  if (typeof text !== 'string') return null

  try {
    const parsed = toMarkdownOutputSchema.safeParse(JSON.parse(text))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function ToMarkdownTool({ input, output }: { input?: unknown; output?: unknown }): ToolDisclosureItem {
  const { t } = useTranslation()
  const sourcePath = readSourcePath(input)
  const receipt = parseReceipt(output)

  return {
    key: TO_MARKDOWN_RUNTIME_TOOL_NAME,
    label: (
      <ToolHeader
        toolName={TO_MARKDOWN_RUNTIME_TOOL_NAME}
        args={input}
        params={
          <SkeletonValue
            value={
              sourcePath ? (
                <ClickableFilePath path={sourcePath} displayName={getFilePreviewFileName(sourcePath)} />
              ) : undefined
            }
            width="120px"
          />
        }
        stats={receipt ? t('message.tools.units.char', { count: receipt.chars }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: receipt ? (
      <div className="flex min-w-0 items-center gap-1.5 py-1 text-[13px] text-muted-foreground">
        <span className="shrink-0">{t('message.tools.labels.toMarkdownOutput')}</span>
        <ClickableFilePath path={receipt.path} />
      </div>
    ) : null
  }
}
