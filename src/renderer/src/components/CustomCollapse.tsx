import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { merge } from 'lodash'
import { ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { memo, useMemo, useState } from 'react'

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
  const getAccordionValue = (keys?: string[]) => (keys?.includes('1') ? '1' : '')
  const [internalValue, setInternalValue] = useState(getAccordionValue(defaultActiveKey))
  const value = activeKey ? getAccordionValue(activeKey) : internalValue
  const activeKeys = value ? ['1'] : []

  const defaultCollapseStyle = {
    width: '100%',
    background: 'transparent',
    border: '0.5px solid var(--color-border)'
  }

  const defaultCollpaseHeaderStyle = {
    padding: '3px 16px',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--color-background-subtle)'
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

  const handleValueChange = (nextValue: string) => {
    const nextKeys = nextValue ? [nextValue] : []

    if (!activeKey) {
      setInternalValue(nextValue)
    }

    onChange?.(nextKeys)
  }

  return (
    <Accordion
      type="single"
      collapsible
      value={value}
      onValueChange={handleValueChange}
      style={collapseStyle}
      className="overflow-hidden rounded-lg">
      <AccordionItem value="1" className="border-0">
        <div className="flex items-center" style={collapseItemStyles.header}>
          <div className="min-w-0 flex-1">
            <AccordionTrigger
              disabled={collapsible === 'disabled'}
              className="min-w-0 flex-1 justify-start gap-2 rounded-none p-0 font-normal hover:no-underline [&>svg:last-child]:hidden">
              <ChevronRight
                size={16}
                color="var(--color-foreground-muted)"
                strokeWidth={1.5}
                className="shrink-0 transition-transform"
                style={{ transform: activeKeys.length > 0 ? 'rotate(90deg)' : 'rotate(0deg)' }}
              />
              <div className="min-w-0 flex-1 text-left">{label}</div>
            </AccordionTrigger>
          </div>
          {extra ? <div className="shrink-0">{extra}</div> : null}
        </div>
        {!destroyInactivePanel || activeKeys.length > 0 ? (
          <AccordionContent className="p-0" style={collapseItemStyles.body}>
            {children}
          </AccordionContent>
        ) : null}
      </AccordionItem>
    </Accordion>
  )
}

export default memo(CustomCollapse)
