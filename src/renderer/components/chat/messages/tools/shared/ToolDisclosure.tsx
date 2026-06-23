import { cn } from '@renderer/utils'
import { ChevronDown } from 'lucide-react'
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useState } from 'react'

export interface ToolDisclosureItem {
  key: string
  label: ReactNode
  children?: ReactNode
  className?: string
  classNames?: {
    item?: string
    header?: string
    body?: string
  }
}

interface ToolDisclosureProps {
  items: ToolDisclosureItem[]
  activeKey?: string[]
  defaultActiveKey?: string[]
  onActiveKeyChange?: (keys: string[]) => void
  className?: string
  itemClassName?: string
  triggerClassName?: string
  bodyClassName?: string
  variant?: 'default' | 'light'
}

export function ToolDisclosure({
  items,
  activeKey,
  defaultActiveKey,
  onActiveKeyChange,
  className,
  itemClassName,
  triggerClassName,
  bodyClassName,
  variant = 'default'
}: ToolDisclosureProps) {
  const isLight = variant === 'light'
  const [internalActiveKeys, setInternalActiveKeys] = useState<string[]>(defaultActiveKey ?? [])
  const currentActiveKeys = activeKey ?? internalActiveKeys

  const toggleKey = (key: string) => {
    const nextActiveKeys = currentActiveKeys.includes(key)
      ? currentActiveKeys.filter((activeKey) => activeKey !== key)
      : [...currentActiveKeys, key]

    if (activeKey === undefined) {
      setInternalActiveKeys(nextActiveKeys)
    }
    onActiveKeyChange?.(nextActiveKeys)
  }

  return (
    <div
      className={cn(
        isLight
          ? 'w-full overflow-hidden bg-transparent'
          : 'w-full overflow-hidden rounded-[7px] border border-border bg-background',
        className
      )}>
      {items.map((item) => {
        const isOpen = currentActiveKeys.includes(item.key)
        const canExpand = item.children !== undefined && item.children !== null

        return (
          <div key={item.key} className={cn('border-none', itemClassName, item.classNames?.item, item.className)}>
            <button
              type="button"
              aria-expanded={canExpand ? isOpen : undefined}
              className={cn(
                'flex w-full items-center justify-between rounded-md border-0 bg-transparent text-left outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
                isLight
                  ? 'min-h-7 justify-start gap-2 py-0.5 font-normal text-[13px] text-foreground-secondary leading-5 hover:no-underline'
                  : 'items-center gap-4 px-2.5 py-2 font-semibold text-foreground/90 text-sm leading-4 hover:no-underline',
                triggerClassName,
                item.classNames?.header
              )}
              onClick={() => canExpand && toggleKey(item.key)}>
              {item.label}
              {canExpand && (
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'ml-auto size-4 shrink-0 text-foreground-muted opacity-70 transition-transform duration-200',
                    isOpen && 'rotate-180'
                  )}
                />
              )}
            </button>
            {canExpand && (
              <DeferredDisclosureContent
                isOpen={isOpen}
                data-testid={`collapse-content-${item.key}`}
                className={cn(
                  isLight
                    ? 'mt-1.5 max-h-96 overflow-auto rounded-xl bg-muted px-4 py-3 text-[13px] text-foreground-secondary leading-5'
                    : 'p-2.5',
                  bodyClassName,
                  item.classNames?.body
                )}>
                {item.children}
              </DeferredDisclosureContent>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DeferredDisclosureContent({
  isOpen,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'> & { isOpen: boolean }) {
  const [shouldRender, setShouldRender] = useState(isOpen)

  useEffect(() => {
    if (!isOpen) {
      setShouldRender(false)
      return
    }

    const timer = window.setTimeout(() => setShouldRender(true), 0)
    return () => window.clearTimeout(timer)
  }, [isOpen])

  return (
    <div hidden={!isOpen} {...props}>
      {shouldRender ? children : null}
    </div>
  )
}
