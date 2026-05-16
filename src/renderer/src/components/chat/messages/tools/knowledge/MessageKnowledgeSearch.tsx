import Spinner from '@renderer/components/Spinner'
import i18n from '@renderer/i18n'
import type { NormalToolResponse } from '@renderer/types'
import { kbSearchInputSchema, type KbSearchOutputItem, kbSearchOutputSchema } from '@shared/ai/builtinTools'
import { FileSearch } from 'lucide-react'

export function MessageKnowledgeSearchToolTitle({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const inputParse = kbSearchInputSchema.safeParse(toolResponse.arguments)
  const outputParse = kbSearchOutputSchema.safeParse(toolResponse.response)
  const query = inputParse.success ? inputParse.data.query : ''
  const resultCount = outputParse.success ? outputParse.data.length : 0

  return toolResponse.status !== 'done' ? (
    <Spinner
      text={
        <span className="flex items-center gap-1 pl-0 text-sm">
          {i18n.t('message.searching')}
          <span>{query}</span>
        </span>
      }
    />
  ) : (
    <span className="flex items-center gap-1 text-foreground-secondary">
      <FileSearch size={16} style={{ color: 'unset' }} />
      {i18n.t('message.websearch.fetch_complete', { count: resultCount })}
    </span>
  )
}

export function MessageKnowledgeSearchToolBody({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const outputParse = kbSearchOutputSchema.safeParse(toolResponse.response)
  if (toolResponse.status !== 'done' || !outputParse.success) return null

  return (
    <ul className="flex flex-col gap-1 p-0 [&>li]:m-0 [&>li]:max-w-[70%] [&>li]:overflow-hidden [&>li]:text-ellipsis [&>li]:whitespace-nowrap [&>li]:p-0">
      {outputParse.data.map((result: KbSearchOutputItem) => (
        <li key={result.id}>
          <span>{result.id}</span>
          <span>{result.content}</span>
        </li>
      ))}
    </ul>
  )
}
