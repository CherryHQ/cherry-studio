import { FileEdit, FileSearch, FileText, Globe, Route, Terminal, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Scrollbar } from '@cherrystudio/ui'
import { StaticMarkdown } from '@renderer/components/markdown'
import type { LocalAcpTool } from '@shared/ai/localAgent'

import { ToolArgsTable } from '../shared/ArgsTable'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { AgentFileDiffView } from './AgentFileDiffView'

const ContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), content: z.object({ type: z.literal('text'), text: z.string() }) }),
  z.object({ type: z.literal('diff'), path: z.string(), oldText: z.string().nullish(), newText: z.string() }),
  z.object({ type: z.literal('terminal'), terminalId: z.string() })
])
const icons = {
  read: FileText,
  edit: FileEdit,
  search: FileSearch,
  execute: Terminal,
  fetch: Globe,
  switch_mode: Route
}

export function AcpTool({ tool }: { tool: LocalAcpTool }): ToolDisclosureItem {
  const { t } = useTranslation()
  const Icon = icons[tool.kind as keyof typeof icons] ?? Wrench
  return {
    key: 'acp-tool',
    label: (
      <span className="inline-flex min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{tool.title}</span>
      </span>
    ),
    children: (
      <div className="space-y-2 text-xs">
        {tool.locations?.map((location) => (
          <div key={`${location.path}:${location.line}`}>
            <ClickableFilePath path={location.path} />
            {location.line != null && <span className="text-muted-foreground">:{location.line}</span>}
          </div>
        ))}
        {tool.content?.map((value, index) => {
          const parsed = ContentSchema.safeParse(value)
          if (!parsed.success)
            return <ToolArgsTable key={index} args={{ content: value }} title={t('message.tools.sections.output')} />
          const item = parsed.data
          if (item.type === 'diff')
            return (
              <div key={index}>
                {!tool.locations?.some((location) => location.path === item.path) && (
                  <ClickableFilePath path={item.path} />
                )}
                <AgentFileDiffView
                  key={index}
                  filePath={item.path}
                  hunks={[{ oldString: item.oldText ?? '', newString: item.newText }]}
                />
              </div>
            )
          if (item.type === 'content') return <StaticMarkdown key={index}>{item.content.text}</StaticMarkdown>
          return (
            <Scrollbar key={index} className="max-h-64 rounded-md bg-muted p-2">
              <pre className="whitespace-pre-wrap break-all font-mono">
                {tool.terminals?.[item.terminalId] ?? item.terminalId}
              </pre>
            </Scrollbar>
          )
        })}
        {tool.rawInput != null && (
          <ToolArgsTable args={{ input: tool.rawInput }} title={t('message.tools.sections.input')} />
        )}
        {tool.rawOutput != null && (
          <ToolArgsTable args={{ output: tool.rawOutput }} title={t('message.tools.sections.output')} />
        )}
      </div>
    )
  }
}
