import { Collapse } from 'antd'
import { FC, memo } from 'react'

interface CustomCollapseProps {
  label: React.ReactNode
  extra: React.ReactNode
  children: React.ReactNode
  destroyInactivePanel?: boolean
  defaultActiveKey?: string[]
  collapsible?: 'header' | 'icon' | 'disabled'
}

const CustomCollapse: FC<CustomCollapseProps> = ({
  label,
  extra,
  children,
  destroyInactivePanel = false,
  defaultActiveKey = ['1'],
  collapsible = undefined
}) => {
  const CollapseStyle = {
    width: '100%',
    background: 'transparent',
    border: '0.5px solid var(--color-border)'
  }
  const CollapseItemStyles = {
    header: {
      padding: '8px 16px',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    body: {
      borderTop: '0.5px solid var(--color-border)'
    }
  }
  return (
    <Collapse
      bordered={false}
      style={CollapseStyle}
      defaultActiveKey={defaultActiveKey}
      destroyInactivePanel={destroyInactivePanel}
      collapsible={collapsible}
      items={[
        {
          styles: CollapseItemStyles,
          key: '1',
          label,
          extra,
          children
        }
      ]}
    />
  )
}

export default memo(CustomCollapse)
