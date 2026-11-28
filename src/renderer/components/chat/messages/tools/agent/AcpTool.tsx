import {
  Brain,
  FileEdit,
  FileSearch,
  FileSymlink,
  FileText,
  FileX2,
  Globe,
  Route,
  Terminal,
  Wrench
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { ScrollArea } from '@cherrystudio/ui'
import { extractLocalAcpRawInputCommand, type LocalAcpTool, LocalAcpToolSchema } from '@shared/ai/localAgent'

import { AcpContentBlock } from '../../blocks/AcpContentBlock'
import { ToolArgsTable } from '../shared/ArgsTable'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { AgentFileDiffView } from './AgentFileDiffView'
import { TerminalOutput } from './TerminalOutput'

const ContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), content: z.unknown() }),
  z.object({ type: z.literal('diff'), path: z.string(), oldText: z.string().nullish(), newText: z.string() }),
  z.object({ type: z.literal('terminal'), terminalId: z.string() })
])
const icons = {
  read: FileText,
  edit: FileEdit,
  delete: FileX2,
  move: FileSymlink,
  search: FileSearch,
  execute: Terminal,
  fetch: Globe,
  think: Brain,
  switch_mode: Route
}

type AcpToolProps = {
  tool: LocalAcpTool
  output?: unknown
}

export function readAcpTool(name: string | undefined, input: unknown): LocalAcpTool | undefined {
  if (!input || typeof input !== 'object') return undefined
  if ('localAcpTool' in input) {
    const native = LocalAcpToolSchema.safeParse(input.localAcpTool)
    if (native.success) return native.data
  }
  if (name === 'ACP: Terminal' && 'command' in input && typeof input.command === 'string') {
    const { command, args, cwd, env } = input as Record<string, unknown>
    return {
      title: name.slice(5),
      kind: 'execute',
      rawInput: {
        command,
        args,
        cwd,
        env: Array.isArray(env)
          ? env.flatMap((entry) => (typeof entry?.name === 'string' ? [entry.name] : []))
          : undefined
      }
    }
  }
  if (name === 'ACP: Write' && 'path' in input && typeof input.path === 'string' && 'content' in input) {
    return {
      title: name.slice(5),
      kind: 'edit',
      locations: [{ path: input.path }],
      rawInput: { content: input.content }
    }
  }
  return undefined
}

export function getAcpToolDisclosure({ tool, output = tool.rawOutput }: AcpToolProps): ToolDisclosureItem {
  const command = extractLocalAcpRawInputCommand(tool.rawInput)
  const Icon = icons[tool.kind as keyof typeof icons] ?? (command ? Terminal : Wrench)
  return {
    key: 'acp-tool',
    label: (
      <span className="inline-flex min-w-0 items-center gap-2">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{tool.title}</span>
      </span>
    ),
    children: <AcpToolDetails tool={tool} output={output} command={command} />
  }
}

function AcpToolDetails({
  tool,
  output,
  command
}: AcpToolProps & { command?: ReturnType<typeof extractLocalAcpRawInputCommand> }) {
  const { t } = useTranslation()
  const content = tool.resultField === 'content' && Array.isArray(output) ? output : tool.content
  const rawInput = tool.rawInput
  const inputArgs =
    rawInput == null ? null : typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : { input: rawInput }
  const args = inputArgs
    ? Object.fromEntries(
        Object.entries(inputArgs).filter(
          ([key, value]) =>
            value !== undefined &&
            key !== command?.key &&
            (key !== 'cwd' || !tool.locations?.some(({ path, line }) => path === value && line == null))
        )
      )
    : null

  return (
    <div className="min-w-0 space-y-2 text-xs">
      {command && (
        <div className="space-y-1">
          <div className="font-medium text-muted-foreground">{t('message.tools.sections.command')}</div>
          <TerminalOutput content={command.command} commandMode maxHeight="10rem" />
        </div>
      )}
      {tool.locations?.map((location) => (
        <div key={`${location.path}:${location.line}`}>
          <ClickableFilePath path={location.path} line={location.line} />
        </div>
      ))}
      {content?.map((value, index) => {
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
        if (item.type === 'content') return <AcpContentBlock key={index} content={item.content} />
        const details = tool.terminalDetails?.[item.terminalId]
        return (
          <div key={index} className="space-y-1">
            <ScrollArea className="max-h-64 rounded-md bg-muted" contentProps={{ className: 'p-2' }}>
              <pre className="whitespace-pre-wrap break-all font-mono">
                {tool.terminals?.[item.terminalId] ?? item.terminalId}
              </pre>
            </ScrollArea>
            {details && (
              <div className="flex gap-2 text-muted-foreground">
                {details.truncated && <span>{t('error.truncatedBadge')}</span>}
                {(details.exitCode != null || details.signal) && (
                  <span>
                    {t('message.tools.sections.exitCode')}: {details.exitCode ?? details.signal}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
      <ToolArgsTable args={args} title={t('message.tools.sections.input')} />
      {tool.resultField !== 'content' && output != null && (
        <ToolArgsTable args={{ output }} title={t('message.tools.sections.output')} />
      )}
    </div>
  )
}
