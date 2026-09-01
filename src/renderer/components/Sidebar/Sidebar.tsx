import './Sidebar.css'

import { MenuItem } from '@cherrystudio/ui'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import { Search } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { getSidebarDisplayWidth, getSidebarLayout } from './constants'
import { DefaultLogo } from './primitives'
import { SidebarFooter, type SidebarFooterActions } from './SidebarFooter'
import { SidebarList } from './SidebarList'
import { SidebarTooltip } from './Tooltip'
import type { ResolvedSidebarEntry, SidebarActiveState, SidebarUser } from './types'
import { useSidebarResize } from './useSidebarResize'

export interface SidebarProps {
  width: number
  setWidth: (width: number) => void
  entries: ResolvedSidebarEntry[]
  active: SidebarActiveState
  title?: string
  logo?: React.ReactNode
  user?: SidebarUser
  isFloating?: boolean
  searchLabel?: string
  extensionsLabel?: string
  actions?: SidebarFooterActions
  onHoverChange?: (visible: boolean) => void
  onResizePreview?: (width: number | null) => void
  onSearchClick?: () => void
  onExtensionsClick?: () => void
  onHeaderClick?: () => void
  onEntriesReorder?: (event: { oldIndex: number; newIndex: number }) => void
  onDismiss?: () => void
}

export function Sidebar({
  width,
  setWidth,
  entries,
  active,
  title = '',
  logo,
  user,
  isFloating = false,
  searchLabel = '',
  extensionsLabel = '',
  actions,
  onHoverChange,
  onResizePreview,
  onSearchClick,
  onExtensionsClick,
  onHeaderClick,
  onEntriesReorder,
  onDismiss
}: SidebarProps) {
  const isMacTransparentWindow = useMacTransparentWindow()
  const { sidebarRef, startResizing } = useSidebarResize(width, setWidth, onResizePreview)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const contextMenuOpenRef = useRef(false)
  const footerOverlayOpenRef = useRef(false)
  const floatingPointerInsideRef = useRef(false)
  const layout = getSidebarLayout(width)
  const showFooter = Boolean(extensionsLabel || user || onExtensionsClick || actions)
  const showSearch = Boolean(onSearchClick)
  const logoNode = logo ?? <DefaultLogo title={title} />

  const renderLogo = (size: 'sm' | 'default' = 'default') => (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden *:h-full *:w-full',
        size === 'sm' ? 'size-7.5 rounded-lg' : 'size-6 rounded-lg'
      )}>
      {logoNode}
    </div>
  )

  const renderHeaderIdentity = (size: 'sm' | 'default', showTitle: boolean) => {
    const content = (
      <>
        {renderLogo(size)}
        {showTitle && <span className="truncate text-sidebar-foreground text-sm">{title}</span>}
      </>
    )

    if (!onHeaderClick) return content

    if (showTitle) {
      return (
        <MenuItem
          variant="ghost"
          icon={<span className="flex size-4 items-center justify-center">{renderLogo(size)}</span>}
          label={title}
          aria-label={title || undefined}
          onClick={onHeaderClick}
          className="cursor-pointer rounded-xl [-webkit-app-region:no-drag]"
        />
      )
    }

    return (
      <button
        type="button"
        aria-label={title || undefined}
        onClick={onHeaderClick}
        className="flex min-w-0 cursor-pointer items-center [-webkit-app-region:no-drag]">
        {content}
      </button>
    )
  }

  const handleDismiss = useCallback(() => {
    onDismiss?.()
  }, [onDismiss])

  const clearHoverDismiss = useCallback(() => {
    if (!hoverTimeout.current) return

    clearTimeout(hoverTimeout.current)
    hoverTimeout.current = null
  }, [])

  const scheduleHoverDismiss = useCallback(() => {
    clearHoverDismiss()
    hoverTimeout.current = setTimeout(handleDismiss, 300)
  }, [clearHoverDismiss, handleDismiss])

  useEffect(() => clearHoverDismiss, [clearHoverDismiss])

  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      contextMenuOpenRef.current = open
      setContextMenuOpen(open)

      if (open) {
        clearHoverDismiss()
        return
      }

      if (isFloating && !floatingPointerInsideRef.current && !footerOverlayOpenRef.current) {
        scheduleHoverDismiss()
      }
    },
    [clearHoverDismiss, isFloating, scheduleHoverDismiss]
  )

  const handleFooterOverlayOpenChange = useCallback(
    (open: boolean) => {
      footerOverlayOpenRef.current = open

      if (open) {
        clearHoverDismiss()
        return
      }

      if (isFloating && !floatingPointerInsideRef.current && !contextMenuOpenRef.current) {
        scheduleHoverDismiss()
      }
    },
    [clearHoverDismiss, isFloating, scheduleHoverDismiss]
  )

  const listProps = {
    entries,
    active,
    onReorder: onEntriesReorder,
    onContextMenuOpenChange: handleContextMenuOpenChange
  }
  const footerProps = {
    user,
    actions,
    extensionsLabel,
    onExtensionsClick,
    onOverlayOpenChange: handleFooterOverlayOpenChange
  }
  const windowDragClassName = contextMenuOpen ? '[-webkit-app-region:no-drag]' : '[-webkit-app-region:drag]'

  // --- Floating sidebar ---
  if (isFloating) {
    return (
      <div className="fixed inset-0 z-40" onClick={handleDismiss}>
        <div
          className={cn(
            'sidebar-theme slide-in-from-left-2 fixed top-0 bottom-0 left-0 flex w-43.5 animate-in select-none flex-col rounded-r-sm rounded-br-2xl bg-sidebar shadow-2xl backdrop-blur-2xl backdrop-saturate-150 duration-200',
            windowDragClassName,
            isMac && 'pt-[env(titlebar-area-height)]'
          )}
          onClick={(event) => event.stopPropagation()}
          onMouseLeave={() => {
            floatingPointerInsideRef.current = false
            if (!contextMenuOpenRef.current && !footerOverlayOpenRef.current) {
              scheduleHoverDismiss()
            }
          }}
          onMouseEnter={() => {
            floatingPointerInsideRef.current = true
            clearHoverDismiss()
          }}>
          <div className={cn('flex h-11 shrink-0 items-center px-2', windowDragClassName)}>
            {renderHeaderIdentity('default', true)}
          </div>

          {showSearch && (
            <div className="px-3 py-2">
              <div
                onClick={() => {
                  onSearchClick?.()
                  handleDismiss()
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-sidebar-accent/50 px-2.5 py-1.5 text-muted-foreground text-xs transition-colors [-webkit-app-region:no-drag] hover:bg-accent">
                <Search size={13} />
                <span>{searchLabel}</span>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
            <SidebarList layout="full" {...listProps} />
          </div>

          {showFooter && (
            <div className="shrink-0">
              <SidebarFooter layout="full" {...footerProps} />
            </div>
          )}
        </div>
      </div>
    )
  }

  // --- Hidden sidebar (hover zone + resize handle) ---
  if (layout === 'hidden') {
    return (
      <div ref={sidebarRef} className="relative h-full w-2 shrink-0">
        <div
          className="absolute inset-y-0 left-0 z-50 w-4 [-webkit-app-region:no-drag]"
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
            hoverTimeout.current = setTimeout(() => onHoverChange?.(true), 200)
          }}
          onMouseLeave={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
          }}>
          <div
            onMouseDown={(event) => {
              onHoverChange?.(false)
              startResizing(event)
            }}
            className="group/handle h-full w-full cursor-col-resize">
            <div className="ml-0.5 h-full w-0.5 rounded-full bg-primary/30 opacity-0 transition-opacity group-hover/handle:opacity-100" />
          </div>
        </div>
      </div>
    )
  }

  // --- Visible sidebar (icon / full) ---
  const actualWidth = getSidebarDisplayWidth(width)

  return (
    <div
      ref={sidebarRef}
      style={{ width: actualWidth }}
      className={cn(
        'sidebar-theme group/sidebar relative z-20 flex h-full shrink-0 select-none flex-col',
        windowDragClassName,
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      {/* Header */}
      <div
        className={cn(
          'flex shrink-0 items-center',
          windowDragClassName,
          layout === 'full' ? 'h-11 px-2' : 'h-11 justify-center'
        )}>
        {renderHeaderIdentity(layout === 'icon' ? 'sm' : 'default', layout === 'full')}
      </div>

      {/* Search */}
      {showSearch &&
        (layout === 'full' ? (
          <div className="px-3 py-2">
            <div
              onClick={onSearchClick}
              className="flex cursor-pointer items-center gap-2 rounded-md bg-sidebar-accent px-2.5 py-1.5 text-muted-foreground text-xs transition-colors [-webkit-app-region:no-drag] hover:bg-accent">
              <Search size={13} />
              <span>{searchLabel}</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1.5 [-webkit-app-region:no-drag]">
            <SidebarTooltip content={searchLabel}>
              <button
                type="button"
                onClick={onSearchClick}
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
                <Search size={16} strokeWidth={1.6} />
              </button>
            </SidebarTooltip>
          </div>
        ))}

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
        <SidebarList layout={layout} {...listProps} />
      </div>

      {/* Footer */}
      {showFooter && (
        <div className="shrink-0">
          <SidebarFooter layout={layout} {...footerProps} />
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={startResizing}
        className="group/handle absolute top-0 right-0 bottom-0 z-50 w-0.75 cursor-col-resize [-webkit-app-region:no-drag]">
        <div className="h-full w-full bg-primary/20 opacity-0 transition-opacity group-hover/handle:opacity-100" />
      </div>
    </div>
  )
}
