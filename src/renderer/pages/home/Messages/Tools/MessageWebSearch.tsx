import type { FetchUrlsToolInput, FetchUrlsToolOutput, WebSearchToolInput } from '@renderer/aiCore/tools/WebSearchTool'
import Spinner from '@renderer/components/Spinner'
import type { NormalToolResponse } from '@renderer/types'
import { Typography } from 'antd'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Text } = Typography

export const MessageWebSearchToolTitle = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const { t } = useTranslation()
  const toolInput = toolResponse.arguments as FetchUrlsToolInput | WebSearchToolInput
  const toolOutput = toolResponse.response as FetchUrlsToolOutput
  const inputs = 'urls' in toolInput ? toolInput.urls : toolInput.queries || [toolInput.additionalContext]

  return toolResponse.status !== 'done' ? (
    <Spinner
      text={
        <PrepareToolWrapper>
          {t('message.searching')}
          <span>{inputs?.join(', ') ?? ''}</span>
        </PrepareToolWrapper>
      }
    />
  ) : (
    <MessageWebSearchToolTitleTextWrapper type="secondary">
      <Search size={16} style={{ color: 'unset' }} />
      {t('message.websearch.fetch_complete', {
        count: toolOutput?.results?.length ?? 0
      })}
    </MessageWebSearchToolTitleTextWrapper>
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
