import { RedoOutlined } from '@ant-design/icons'
import { Empty } from 'antd'
import styled from 'styled-components'

export const ClickableSpan = styled.span`
  cursor: pointer;
  flex: 1;
  width: 0;
`
export const FlexAlignCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

export const ItemContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  flex: 1;
`

export const ItemHeader = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  position: absolute;
  right: 16px;
  z-index: 1000;
  top: calc(var(--navbar-height) + 12px);
  [navbar-position='top'] & {
    top: calc(var(--navbar-height) + 10px);
  }
`

export const KnowledgeEmptyView = () => <Empty style={{ margin: 20 }} styles={{ image: { display: 'none' } }} />

export const RefreshIcon = styled(RedoOutlined)`
  font-size: 15px !important;
  color: var(--color-text-2);
`

export const StatusIconWrapper = styled.div`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
`
