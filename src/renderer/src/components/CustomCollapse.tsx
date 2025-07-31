import { Collapse } from 'antd'
import { merge } from 'lodash'
import { ChevronRight } from 'lucide-react'
import { FC, memo, useMemo, useState } from 'react'

interface CustomCollapseProps {
  label: React.ReactNode
  extra: React.ReactNode
  children: React.ReactNode
  destroyInactivePanel?: boolean
  defaultActiveKey?: string[]
  activeKey?: string[]
  collapsible?: 'header' | 'icon' | 'disabled'
  onChange?: (activeKeys: string | string[]) => void
  style?: React.CSSProperties
  styles?: {
    header?: React.CSSProperties
    body?: React.CSSProperties
  }
}

const CustomCollapse: FC<CustomCollapseProps> = ({
  label,
  extra,
  children,
  destroyInactivePanel = false,
  defaultActiveKey = ['1'],
  activeKey,
  collapsible = undefined,
  onChange,
  style,
  styles
}) => {
  const [activeKeys, setActiveKeys] = useState(activeKey || defaultActiveKey)

  const defaultCollapseStyle = {
    width: '100%',
    background: 'transparent',
    border: '0.5px solid var(--color-border)'
  }

  const defaultCollpaseHeaderStyle = {
    padding: '3px 16px',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--color-background-soft)'
  }

  const getHeaderStyle = () => {
    return activeKeys && activeKeys.length > 0
      ? {
          ...defaultCollpaseHeaderStyle,
          borderTopLeftRadius: '8px',
          borderTopRightRadius: '8px'
        }
      : {
          ...defaultCollpaseHeaderStyle,
          borderRadius: '8px'
        }
  }

  const defaultCollapseItemStyles = {
    header: getHeaderStyle(),
    body: {
      borderTop: 'none'
    }
  }

  const collapseStyle = merge({}, defaultCollapseStyle, style)
  const collapseItemStyles = useMemo(() => {
    return merge({}, defaultCollapseItemStyles, styles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeys])

  return (
    <Collapse
      bordered={false}
      style={collapseStyle}
      defaultActiveKey={defaultActiveKey}
      activeKey={activeKey}
      destroyInactivePanel={destroyInactivePanel}
      collapsible={collapsible}
      onChange={(keys) => {
        setActiveKeys(keys)
        onChange?.(keys)
      }}
      expandIcon={({ isActive }) => (
        <ChevronRight
          size={16}
          color="var(--color-text-3)"
          strokeWidth={1.5}
          style={{ transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
      )}
      items={[
        {
          styles: collapseItemStyles,
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
