import Spinner from '@renderer/components/Spinner'
import type { NormalToolResponse } from '@renderer/types'
import { webSearchInputSchema, type WebSearchOutputItem, webSearchOutputSchema } from '@shared/ai/builtinTools'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ToolDisclosure } from '../shared/ToolDisclosure'

const MessageWebSearchToolLabel = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const { t } = useTranslation()
  const inputParse = webSearchInputSchema.safeParse(toolResponse.arguments)
  const outputParse = webSearchOutputSchema.safeParse(toolResponse.response)
  const query = inputParse.success ? inputParse.data.query : ''
  const resultCount = outputParse.success ? outputParse.data.length : 0
  const resultText =
    resultCount === 0
      ? t('message.websearch.fetch_empty')
      : t('message.websearch.fetch_complete', { count: resultCount })

  return toolResponse.status !== 'done' ? (
    <Spinner
      text={
        <span className="flex min-w-0 items-center gap-1 py-0.5 text-[13px] leading-5">
          {t('message.searching')}
          <span className="min-w-0 truncate">{query}</span>
        </span>
      }
    />
  ) : (
    <span className="flex items-center gap-1.5 py-0.5 text-[13px] text-foreground-secondary leading-5 transition-colors duration-150 group-hover/tool:text-foreground">
      <Search
        size={14}
        className="shrink-0 text-foreground-muted transition-colors duration-150 group-hover/tool:text-foreground-secondary"
      />
      {resultText}
    </span>
  )
}

export const MessageWebSearchToolTitle = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const outputParse = webSearchOutputSchema.safeParse(toolResponse.response)
  const hasResults = toolResponse.status === 'done' && outputParse.success && outputParse.data.length > 0
  const label = <MessageWebSearchToolLabel toolResponse={toolResponse} />

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
            children: <MessageWebSearchToolBody toolResponse={toolResponse} />
          }
        ]}
      />
    </div>
  )
}

export const MessageWebSearchToolBody = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const outputParse = webSearchOutputSchema.safeParse(toolResponse.response)
  if (toolResponse.status !== 'done' || !outputParse.success) return null

  return (
    <ul className="flex flex-col gap-1 p-0 text-[13px] leading-5 [&>li]:m-0 [&>li]:min-w-0 [&>li]:overflow-hidden [&>li]:text-ellipsis [&>li]:whitespace-nowrap [&>li]:p-0">
      {outputParse.data.map((result: WebSearchOutputItem) => (
        <li key={result.id}>
          <a href={result.url} target="_blank" rel="noreferrer">
            {result.title || result.url}
          </a>
        </li>
      ))}
    </ul>
  )
}
