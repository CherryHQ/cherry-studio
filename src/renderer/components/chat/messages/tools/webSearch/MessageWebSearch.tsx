import Favicon from '@renderer/components/Icons/FallbackFavicon'
import Spinner from '@renderer/components/Spinner'
import type { NormalToolResponse } from '@renderer/types'
import { webSearchInputSchema, type WebSearchOutputItem, webSearchOutputSchema } from '@shared/ai/builtinTools'
import { useTranslation } from 'react-i18next'

import Link from '../../markdown/Link'
import { ToolDisclosure } from '../shared/ToolDisclosure'

/** Split a result URL into the favicon hostname (keeps `www.`) and the display domain (drops it). */
function parseResultUrl(url: string): { hostname: string; domain: string } {
  try {
    const hostname = new URL(url).hostname
    return { hostname, domain: hostname.replace(/^www\./, '') }
  } catch {
    return { hostname: '', domain: url }
  }
}

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

  if (toolResponse.status !== 'done') {
    return (
      <Spinner
        text={
          <span className="flex min-w-0 items-center gap-1 py-0.5 text-[13px] leading-5">
            {t('message.searching')}
            <span className="min-w-0 truncate">{query}</span>
          </span>
        }
      />
    )
  }

  // Query on the left, result count on the right (mirrors the reference layout).
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3 py-0.5 text-[13px] text-foreground-secondary leading-5 transition-colors duration-150 group-hover/tool:text-foreground">
      <span className="min-w-0 truncate">{query || resultText}</span>
      {query && <span className="shrink-0 text-foreground-muted">{resultText}</span>}
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
    <ul className="flex flex-col gap-0.5 p-0 text-[13px] leading-5 [&>li]:m-0 [&>li]:p-0">
      {outputParse.data.map((result: WebSearchOutputItem) => {
        const { hostname, domain } = parseResultUrl(result.url)
        return (
          <li key={result.id}>
            <Link
              href={result.url}
              className="-mx-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 no-underline transition-colors hover:bg-accent">
              {hostname && <Favicon hostname={hostname} alt={result.title || domain} />}
              <span className="min-w-0 flex-1 truncate text-foreground">{result.title || result.url}</span>
              <span className="max-w-[40%] shrink-0 truncate text-foreground-muted">{domain}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
