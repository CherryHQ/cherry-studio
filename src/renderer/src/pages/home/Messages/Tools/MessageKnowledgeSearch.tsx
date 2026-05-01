import Spinner from '@renderer/components/Spinner'
import i18n from '@renderer/i18n'
import type { NormalToolResponse } from '@renderer/types'
import { kbSearchInputSchema, type KbSearchOutputItem, kbSearchOutputSchema } from '@shared/data/types/builtin-tools'
import { Typography } from 'antd'
import { FileSearch } from 'lucide-react'
import styled from 'styled-components'

const { Text } = Typography

export function MessageKnowledgeSearchToolTitle({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const inputParse = kbSearchInputSchema.safeParse(toolResponse.arguments)
  const outputParse = kbSearchOutputSchema.safeParse(toolResponse.response)
  const query = inputParse.success ? inputParse.data.query : ''
  const resultCount = outputParse.success ? outputParse.data.length : 0

  return toolResponse.status !== 'done' ? (
    <Spinner
      text={
        <PrepareToolWrapper>
          {i18n.t('message.searching')}
          <span>{query}</span>
        </PrepareToolWrapper>
      }
    />
  ) : (
    <MessageWebSearchToolTitleTextWrapper type="secondary">
      <FileSearch size={16} style={{ color: 'unset' }} />
      {i18n.t('message.websearch.fetch_complete', { count: resultCount })}
    </MessageWebSearchToolTitleTextWrapper>
  )
}

export function MessageKnowledgeSearchToolBody({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const outputParse = kbSearchOutputSchema.safeParse(toolResponse.response)
  if (toolResponse.status !== 'done' || !outputParse.success) return null

  return (
    <MessageWebSearchToolBodyUlWrapper>
      {outputParse.data.map((result: KbSearchOutputItem) => (
        <li key={result.id}>
          <span>{result.id}</span>
          <span>{result.content}</span>
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
  padding-left: 0;
`
const MessageWebSearchToolTitleTextWrapper = styled(Text)`
  display: flex;
  align-items: center;
  gap: 4px;
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
