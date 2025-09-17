// Original path: src/renderer/src/components/CustomCollapse.tsx
import { ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { memo, useState } from 'react'

interface CustomCollapseProps {
  label: React.ReactNode
  extra?: React.ReactNode
  children: React.ReactNode
  destroyInactivePanel?: boolean
  defaultActiveKey?: string[]
  activeKey?: string[]
  collapsible?: 'header' | 'icon' | 'disabled'
  onChange?: (activeKeys: string | string[]) => void
  className?: string
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
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(activeKey ? activeKey.includes('1') : defaultActiveKey.includes('1'))

  const handleToggle = () => {
    if (collapsible === 'disabled') return

    const newState = !isOpen
    setIsOpen(newState)
    onChange?.(newState ? ['1'] : [])
  }

  const shouldRenderContent = !destroyInactivePanel || isOpen

  return (
    <div className={`w-full bg-transparent border border-gray-200 dark:border-gray-700 ${className}`}>
      <div
        className={`flex items-center justify-between px-4 py-1 cursor-pointer bg-gray-50 dark:bg-gray-800 ${
          isOpen ? 'rounded-t-lg' : 'rounded-lg'
        } ${collapsible === 'disabled' ? 'cursor-default' : ''}`}
        onClick={collapsible === 'header' || collapsible === undefined ? handleToggle : undefined}>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center">
            {(collapsible === 'icon' || collapsible === undefined) && (
              <div className="mr-2 cursor-pointer" onClick={collapsible === 'icon' ? handleToggle : undefined}>
                <ChevronRight
                  size={16}
                  className={`text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                    isOpen ? 'rotate-90' : 'rotate-0'
                  }`}
                  strokeWidth={1.5}
                />
              </div>
            )}
            {label}
          </div>
          {extra && <div>{extra}</div>}
        </div>
      </div>
      {isOpen && <div className="border-t-0">{shouldRenderContent && children}</div>}
    </div>
  )
}

export default memo(CustomCollapse)
