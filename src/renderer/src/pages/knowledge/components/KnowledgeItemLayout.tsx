import { Button, RowFlex } from '@cherrystudio/ui'
import { Empty } from 'antd'
import { RotateCw } from 'lucide-react'
import type { FC } from 'react'
import styled from 'styled-components'

export const KnowledgeEmptyView = () => <Empty style={{ margin: 20 }} styles={{ image: { display: 'none' } }} />

export const ItemHeaderLabel: FC<{ label: string }> = ({ label }) => {
  return (
    <RowFlex className="items-center gap-2.5">
      <label style={{ fontWeight: 600 }}>{label}</label>
    </RowFlex>
  )
}

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

export const StatusIconWrapper = styled.div`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
`

export const RefreshIcon = () => <RotateCw size={15} className="text-muted-foreground" />

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

export const ResponsiveButton = styled(Button)`
  @media (max-width: 1080px) {
    [data-slot="icon"] + [data-slot="label"] {
      display: none;
    }
  }
`
