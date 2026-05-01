import Spinner from '@renderer/components/Spinner'
import type { NormalToolResponse } from '@renderer/types'
import { webSearchInputSchema, type WebSearchOutputItem, webSearchOutputSchema } from '@shared/data/types/builtin-tools'
import { Typography } from 'antd'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Text } = Typography

export const MessageWebSearchToolTitle = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const { t } = useTranslation()
  const inputParse = webSearchInputSchema.safeParse(toolResponse.arguments)
  const outputParse = webSearchOutputSchema.safeParse(toolResponse.response)
  const query = inputParse.success ? inputParse.data.query : ''
  const resultCount = outputParse.success ? outputParse.data.length : 0

  return toolResponse.status !== 'done' ? (
    <Spinner
      text={
        <PrepareToolWrapper>
          {t('message.searching')}
          <span>{query}</span>
        </PrepareToolWrapper>
      }
    />
  ) : (
    <MessageWebSearchToolTitleTextWrapper type="secondary">
      <Search size={16} style={{ color: 'unset' }} />
      {t('message.websearch.fetch_complete', { count: resultCount })}
    </MessageWebSearchToolTitleTextWrapper>
  )
}

export const MessageWebSearchToolBody = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const outputParse = webSearchOutputSchema.safeParse(toolResponse.response)
  if (toolResponse.status !== 'done' || !outputParse.success) return null

  return (
    <MessageWebSearchToolBodyUlWrapper>
      {outputParse.data.map((result: WebSearchOutputItem) => (
        <li key={result.id}>
          <a href={result.url} target="_blank" rel="noreferrer">
            {result.title || result.url}
          </a>
        </li>
      ))}
    </MessageWebSearchToolBodyUlWrapper>
  )
}

const PrepareToolWrapper = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  padding: 5px;
  padding-left: 0;
`

const MessageWebSearchToolTitleTextWrapper = styled(Text)`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
`

const MessageWebSearchToolBodyUlWrapper = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  > li {
    padding: 0;
    margin: 0;
    max-width: 70%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`
