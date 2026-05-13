import Spinner from '@renderer/components/Spinner'
import type { NormalToolResponse } from '@renderer/types'
import { webSearchInputSchema, type WebSearchOutputItem, webSearchOutputSchema } from '@shared/ai/builtinTools'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const MessageWebSearchToolTitle = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const { t } = useTranslation()
  const inputParse = webSearchInputSchema.safeParse(toolResponse.arguments)
  const outputParse = webSearchOutputSchema.safeParse(toolResponse.response)
  const query = inputParse.success ? inputParse.data.query : ''
  const resultCount = outputParse.success ? outputParse.data.length : 0

  return toolResponse.status !== 'done' ? (
    <Spinner
      text={
        <span className="flex items-center gap-1 py-[5px] pr-[5px] pl-0 text-sm">
          {t('message.searching')}
          <span>{query}</span>
        </span>
      }
    />
  ) : (
    <span className="flex items-center gap-1 p-[5px] text-(--color-text-2)">
      <Search size={16} style={{ color: 'unset' }} />
      {t('message.websearch.fetch_complete', { count: resultCount })}
    </span>
  )
}

export const MessageWebSearchToolBody = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const outputParse = webSearchOutputSchema.safeParse(toolResponse.response)
  if (toolResponse.status !== 'done' || !outputParse.success) return null

  return (
    <ul className="flex flex-col gap-1 p-0 [&>li]:m-0 [&>li]:max-w-[70%] [&>li]:overflow-hidden [&>li]:text-ellipsis [&>li]:whitespace-nowrap [&>li]:p-0">
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
