import { MemorySearchToolInput, MemorySearchToolOutput } from '@renderer/aiCore/tools/MemorySearchTool'
import Spinner from '@renderer/components/Spinner'
import { MCPToolResponse } from '@renderer/types'
import { Typography } from 'antd'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Text } = Typography

export const MessageMemorySearchToolTitle = ({ toolResponse }: { toolResponse: MCPToolResponse }) => {
  const { t } = useTranslation()
  const toolInput = toolResponse.arguments as MemorySearchToolInput
  const toolOutput = toolResponse.response as MemorySearchToolOutput

  return toolResponse.status !== 'done' ? (
    <Spinner
      text={
        <MessageWebSearchToolTitleTextWrapper>
          {t('memory.search_placeholder')}
          <span>{toolInput?.query ?? ''}</span>
        </MessageWebSearchToolTitleTextWrapper>
      }
    />
  ) : toolOutput?.length ? (
    <MessageWebSearchToolTitleTextWrapper type="secondary">
      <ChevronRight size={16} style={{ color: 'unset' }} />
      {/* <Search size={16} style={{ color: 'unset' }} /> */}
      <span>{toolOutput?.length ?? 0}</span>
      {t('memory.memory')}
    </MessageWebSearchToolTitleTextWrapper>
  ) : null
}

const MessageWebSearchToolTitleTextWrapper = styled(Text)`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  padding-left: 0;
`
