import Spinner from '@renderer/components/Spinner'
import i18n from '@renderer/i18n'
import type { NormalToolResponse } from '@renderer/types'
import { kbSearchInputSchema, type KbSearchOutputItem, kbSearchOutputSchema } from '@shared/ai/builtinTools'
import { FileSearch } from 'lucide-react'

import { ToolDisclosure } from '../shared/ToolDisclosure'

function MessageKnowledgeSearchToolLabel({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const inputParse = kbSearchInputSchema.safeParse(toolResponse.arguments)
  const outputParse = kbSearchOutputSchema.safeParse(toolResponse.response)
  const query = inputParse.success ? inputParse.data.query : ''
  const resultCount = outputParse.success ? outputParse.data.length : 0

  return toolResponse.status !== 'done' ? (
    <Spinner
      text={
        <span className="flex min-w-0 items-center gap-1 py-0.5 text-[13px] leading-5">
          {i18n.t('message.searching')}
          <span className="min-w-0 truncate">{query}</span>
        </span>
      }
    />
  ) : (
    <span className="flex items-center gap-1.5 py-0.5 text-[13px] text-foreground-secondary leading-5 transition-colors duration-150 group-hover/tool:text-foreground">
      <FileSearch
        size={14}
        className="shrink-0 text-foreground-muted transition-colors duration-150 group-hover/tool:text-foreground-secondary"
      />
      {i18n.t('message.websearch.fetch_complete', { count: resultCount })}
    </span>
  )
}

export function MessageKnowledgeSearchToolTitle({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const outputParse = kbSearchOutputSchema.safeParse(toolResponse.response)
  const hasResults = toolResponse.status === 'done' && outputParse.success && outputParse.data.length > 0
  const label = <MessageKnowledgeSearchToolLabel toolResponse={toolResponse} />

  if (!hasResults) return label

  return (
    <div className="group/tool my-px first:mt-0 first:pt-0">
      <ToolDisclosure
        variant="light"
        className="message-tools-container border-none"
        items={[
          {
            key: toolResponse.id,
            label,
            children: <MessageKnowledgeSearchToolBody toolResponse={toolResponse} />
          }
        ]}
      />
    </div>
  )
}

export function MessageKnowledgeSearchToolBody({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const outputParse = kbSearchOutputSchema.safeParse(toolResponse.response)
  if (toolResponse.status !== 'done' || !outputParse.success) return null

  return (
    <ul className="flex flex-col gap-1 p-0 text-[13px] leading-5 [&>li]:m-0 [&>li]:min-w-0 [&>li]:p-0">
      {outputParse.data.map((result: KbSearchOutputItem) => (
        <li key={result.id} className="flex min-w-0 gap-2">
          <span className="shrink-0 text-foreground-muted">{result.id}</span>
          <span className="min-w-0 truncate">{result.content}</span>
        </li>
      ))}
    </ul>
  )
}
