import { cn } from '@renderer/utils/style'
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useState } from 'react'

import { useScrollAnchor } from '../../blocks/useScrollAnchor'

export interface ToolDisclosureItem {
  key: string
  label: ReactNode
  extra?: ReactNode
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
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()

  const toggleKey = (key: string) => {
    const isOpening = !currentActiveKeys.includes(key)
    const nextActiveKeys = isOpening
      ? [...currentActiveKeys, key]
      : currentActiveKeys.filter((activeKey) => activeKey !== key)

    withScrollAnchor(
      () => {
        if (activeKey === undefined) {
          setInternalActiveKeys(nextActiveKeys)
        }
        onActiveKeyChange?.(nextActiveKeys)
      },
      { enterReadingMode: isOpening }
    )
  }

  return (
    <div
      ref={anchorRef}
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
            <div className="flex w-fit items-center">
              <button
                type="button"
                aria-expanded={canExpand ? isOpen : undefined}
                className={cn(
                  'flex w-fit items-center justify-between rounded-md border-0 bg-transparent text-left outline-none transition-colors focus-visible:bg-accent/50 disabled:pointer-events-none disabled:opacity-50',
                  isLight
                    ? 'min-h-7 justify-start gap-2 py-0.5 font-normal text-[13px] text-muted-foreground leading-5 hover:no-underline'
                    : 'items-center gap-4 px-2.5 py-2 font-semibold text-foreground text-sm leading-4 hover:no-underline',
                  triggerClassName,
                  item.classNames?.header
                )}
                onClick={() => canExpand && toggleKey(item.key)}>
                {item.label}
              </button>
              {item.extra}
            </div>
            {canExpand && (
              <DeferredDisclosureContent
                isOpen={isOpen}
                data-testid={`collapse-content-${item.key}`}
                className={cn(
                  isLight
                    ? 'mt-1.5 max-h-96 overflow-auto rounded-xl bg-muted px-4 py-3 text-[13px] text-muted-foreground leading-5'
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
