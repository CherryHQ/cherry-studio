import { Collapse } from 'antd'
import { FC, memo } from 'react'

interface CustomCollapseProps {
  label: React.ReactNode
  extra: React.ReactNode
  children: React.ReactNode
}

const CustomCollapse: FC<CustomCollapseProps> = ({ label, extra, children }) => {
  const CollapseStyle = {
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
      defaultActiveKey={['1']}
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
