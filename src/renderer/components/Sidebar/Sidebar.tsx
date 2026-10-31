import '../layout/ShellNavigation.css'
import { ChevronDown, Search } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { Button, Separator, Tooltip } from '@cherrystudio/ui'
import { useLeadingWindowControlsOverlay } from '@renderer/hooks/useLeadingWindowControlsOverlay'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

import { getSidebarDisplayWidth, getSidebarLayout } from './constants'
import { UserAvatar } from './primitives'
import { SidebarFooter, type SidebarFooterActions } from './SidebarFooter'
import { SidebarList } from './SidebarList'
import { SidebarTooltip } from './Tooltip'
import type { ResolvedSidebarEntry, SidebarUser } from './types'
import { useSidebarResize } from './useSidebarResize'

export interface SidebarProps {
  width: number
  setWidth: (width: number) => void
  entries: ResolvedSidebarEntry[]
  emptyHint?: string
  user?: SidebarUser
  isFloating?: boolean
  isFullscreen?: boolean
  searchLabel?: string
  extensionsLabel?: string
  actions?: SidebarFooterActions
  userAction?: SidebarFooterActions
  onHoverChange?: (visible: boolean) => void
  onResizePreview?: (width: number | null) => void
  onSearchClick?: () => void
  onExtensionsClick?: () => void
  renderUserTrigger?: (trigger: React.ReactElement) => React.ReactElement
  onEntriesReorder?: (event: { oldIndex: number; newIndex: number }) => void
  onDismiss?: () => void
}

export function Sidebar({
  width,
  setWidth,
  entries,
  emptyHint,
  user,
  isFloating = false,
  isFullscreen = false,
  searchLabel = '',
  extensionsLabel = '',
  actions,
  userAction,
  onHoverChange,
  onResizePreview,
  onSearchClick,
  onExtensionsClick,
  renderUserTrigger,
  onEntriesReorder,
  onDismiss
}: SidebarProps) {
  const isMacTransparentWindow = useMacTransparentWindow()
  const hasLeadingWindowControls = useLeadingWindowControlsOverlay()
  const { sidebarRef, startResizing } = useSidebarResize(width, setWidth, onResizePreview)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const contextMenuOpenRef = useRef(false)
  const footerOverlayOpenRef = useRef(false)
  const floatingPointerInsideRef = useRef(false)
  const layout = getSidebarLayout(width)
  const showUserInFooter = isMac && !isFullscreen
  const showFooter = Boolean(
    extensionsLabel || onExtensionsClick || actions || userAction || (showUserInFooter && user)
  )
  const showSearch = Boolean(onSearchClick)

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
    onReorder: onEntriesReorder,
    onContextMenuOpenChange: handleContextMenuOpenChange
  }
  const windowDragClassName = contextMenuOpen ? '[-webkit-app-region:no-drag]' : '[-webkit-app-region:drag]'
  const contentLayout = isFloating ? 'full' : layout
  const showHeaderDivider = !showUserInFooter && contentLayout === 'icon' && (isFullscreen || !hasLeadingWindowControls)
  const emptyState =
    entries.length === 0 && contentLayout === 'full' && emptyHint ? (
      <p className="px-4 py-3 text-xs text-muted-foreground [-webkit-app-region:no-drag]">{emptyHint}</p>
    ) : null

  const footerProps = {
    user: showUserInFooter ? user : undefined,
    renderUserTrigger,
    userAction,
    actions,
    extensionsLabel,
    onExtensionsClick,
    onOverlayOpenChange: handleFooterOverlayOpenChange
  }
  const userButton = user ? (
    <Button
      variant="ghost"
      aria-label={user.name}
      onClick={user.onClick}
      className={cn(
        'flex min-w-0 max-w-full items-center gap-2 [-webkit-app-region:no-drag]',
        contentLayout === 'full'
          ? 'shell-navigation-item h-9 w-full justify-start rounded-full px-2 text-left'
          : 'rounded-lg p-0 text-sidebar-foreground hover:bg-transparent hover:text-sidebar-foreground'
      )}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-lg *:h-full *:w-full',
          contentLayout === 'full' ? 'size-6' : 'size-7.5'
        )}>
        <UserAvatar user={user} className="h-full w-full" />
      </span>
      {contentLayout === 'full' && (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] text-sidebar-foreground">{user.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.6} />
        </>
      )}
    </Button>
  ) : null
  const header =
    !showUserInFooter && user && userButton ? (
      <div
        className={cn(
          'relative flex shrink-0',
          showHeaderDivider && 'mb-2',
          contentLayout === 'icon' ? 'h-11 items-center' : 'h-12 items-center',
          contentLayout === 'full' ? 'px-2' : 'justify-center'
        )}>
        <Tooltip content={user.name} placement="right" delay={400} fullWidthTrigger={contentLayout === 'full'}>
          {renderUserTrigger?.(userButton) ?? userButton}
        </Tooltip>
        {showHeaderDivider && (
          <Separator className="absolute top-full left-1/2 -translate-x-1/2 data-[orientation=horizontal]:w-4" />
        )}
      </div>
    ) : null

  // --- Floating sidebar ---
  if (isFloating) {
    return (
      <div className="fixed inset-0 z-40" onClick={handleDismiss}>
        <div
          className={cn(
            'shell-navigation slide-in-from-left-2 fixed top-0 bottom-0 left-0 flex w-43.5 animate-in select-none flex-col rounded-r-sm rounded-br-2xl bg-sidebar shadow-2xl backdrop-blur-2xl backdrop-saturate-150 duration-200',
            '[-webkit-app-region:no-drag]',
            (showUserInFooter || hasLeadingWindowControls) && 'pt-[env(titlebar-area-height)]'
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
          {header}
          {showSearch && (
            <div className="px-3 py-2">
              <Button
                type="button"
                variant="ghost"
                aria-label={searchLabel}
                onClick={() => {
                  onSearchClick?.()
                  handleDismiss()
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-sidebar-accent/50 px-2.5 py-1.5 text-muted-foreground text-xs transition-colors [-webkit-app-region:no-drag] hover:bg-accent">
                <Search size={13} />
                <span>{searchLabel}</span>
              </Button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
            <SidebarList layout="full" {...listProps} />
            {emptyState}
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
      <div ref={sidebarRef} className="relative h-full w-1.5 shrink-0">
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
        'shell-navigation group/sidebar relative z-20 flex h-full shrink-0 select-none flex-col',
        windowDragClassName,
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      {header}
      {/* Search */}
      {showSearch &&
        (layout === 'full' ? (
          <div className="px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              aria-label={searchLabel}
              onClick={onSearchClick}
              className="flex cursor-pointer items-center gap-2 rounded-md bg-sidebar-accent px-2.5 py-1.5 text-muted-foreground text-xs transition-colors [-webkit-app-region:no-drag] hover:bg-accent">
              <Search size={13} />
              <span>{searchLabel}</span>
            </Button>
          </div>
        ) : (
          <div className="flex justify-center py-1.5 [-webkit-app-region:no-drag]">
            <SidebarTooltip content={searchLabel}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={searchLabel}
                onClick={onSearchClick}
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
                <Search size={16} strokeWidth={1.6} />
              </Button>
            </SidebarTooltip>
          </div>
        ))}

      {/* Content */}
      <div
        className={cn('min-h-0 flex-1 overflow-y-auto pb-1 [&::-webkit-scrollbar]:hidden', showUserInFooter && 'pt-1')}>
        <SidebarList layout={layout} {...listProps} />
        {emptyState}
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
