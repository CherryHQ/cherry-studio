import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { Collapse, type CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageTools from '../Tools/MessageTools'

interface Props {
  blocks: ToolMessageBlock[]
}

const ToolBlockGroup: React.FC<Props> = ({ blocks }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const items: CollapseProps['items'] = useMemo(() => {
    return [
      {
        key: 'tool-group',
        label: (
          <GroupHeader>
            <Wrench size={14} className="tool-icon" />
            <span className="tool-count">{t('message.tools.groupHeader', { count: blocks.length })}</span>
          </GroupHeader>
        ),
        children: (
          <ToolList>
            {blocks.map((block) => (
              <ToolItem key={block.id}>
                <MessageTools block={block} />
              </ToolItem>
            ))}
          </ToolList>
        )
      }
    ]
  }, [blocks, t])

  return (
    <Container>
      <Collapse
        ghost
        size="small"
        expandIconPosition="end"
        activeKey={expanded ? ['tool-group'] : []}
        onChange={(keys) => setExpanded(keys.includes('tool-group'))}
        items={items}
      />
    </Container>
  )
}

export default React.memo(ToolBlockGroup)

const Container = styled.div`
  width: 100%;
  max-width: 36rem;

  .ant-collapse {
    background: transparent;
    border: none;
  }

  .ant-collapse-item {
    border: none !important;
  }

  .ant-collapse-header {
    padding: 8px 12px !important;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 0.75rem !important;
  }

  .ant-collapse-content {
    border: none;
    background: transparent;
  }

  .ant-collapse-content-box {
    padding: 4px 0 0 0 !important;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
`

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;

  .tool-icon {
    color: var(--color-primary);
  }

  .tool-count {
    color: var(--color-text-1);
  }
`

const ToolList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ToolItem = styled.div``
