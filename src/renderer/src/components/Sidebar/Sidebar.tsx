import { LogoAvatar } from '@renderer/components/Icons'
import { ChevronRight, Columns2, Search, X } from 'lucide-react'
import React, { useCallback, useEffect, useRef } from 'react'

import {
  getSidebarLayout,
  SIDEBAR_FULL_WIDTH,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_VERTICAL_CARD_WIDTH
} from './constants'
import { SidebarTooltip } from './Tooltip'
import type { SidebarMenuItem, SidebarTab, SidebarUser } from './types'

function DefaultLogo({ title }: { title: string }) {
  const firstLetter = title ? title.slice(0, 1).toUpperCase() : ''

  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15 font-medium text-primary text-sm">
      {firstLetter}
    </div>
  )
}

function MiniAppIcon({ tab, size = 'sm' }: { tab: SidebarTab; size?: 'sm' | 'md' }) {
  const pixelSize = size === 'sm' ? 14 : 16
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const fontSize = size === 'sm' ? 'text-[6px]' : 'text-[8px]'
  const backgroundColor = tab.miniAppColor ?? 'transparent'
  const initial = tab.miniAppInitial ?? ''

  if (tab.miniAppLogo) {
    return <LogoAvatar logo={tab.miniAppLogo} size={pixelSize} shape="rounded" />
  }

  if (tab.miniAppLogoUrl) {
    return <img src={tab.miniAppLogoUrl} alt="" className={`${iconSize} flex-shrink-0 rounded-[3px] object-cover`} />
  }

  return (
    <div
      className={`${iconSize} ${fontSize} flex flex-shrink-0 items-center justify-center rounded-[3px] text-white`}
      style={{ background: backgroundColor }}>
      {initial}
    </div>
  )
}

function FullMenuItems({
  items,
  activeItem,
  onItemClick,
  activeMiniAppTabs,
  activeTabId,
  onMiniAppTabClick
}: {
  items: SidebarMenuItem[]
  activeItem: string
  onItemClick: (id: string) => void
  activeMiniAppTabs: SidebarTab[]
  activeTabId?: string
  onMiniAppTabClick?: (tabId: string) => void
}) {
  return (
    <div className="space-y-0.5 px-2">
      {items.map((item) => {
        const isActive = activeItem === item.id
        const Icon = item.icon
        const miniTabs = item.id === 'minapp' ? activeMiniAppTabs : []

        return (
          <div key={item.id}>
            <button
              type="button"
              onClick={() => onItemClick(item.id)}
              className={`relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-[13px] transition-all duration-150 ${
                isActive
                  ? 'bg-cherry-active-bg text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              }`}>
              {isActive && (
                <div className="pointer-events-none absolute inset-0 rounded-xl border border-cherry-active-border" />
              )}
              {isActive && (
                <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 flex items-center">
                  <div className="h-[24px] w-[10px] rounded-tl-[8px] rounded-bl-[8px] bg-cherry-glow-bg blur-[6px]" />
                  <div className="absolute right-0 h-[10px] w-[3px] rounded-[100px] bg-cherry-glow-line blur-[2px]" />
                </div>
              )}
              <Icon size={16} strokeWidth={1.6} />
              <span className="truncate">{item.label}</span>
            </button>

            {miniTabs.map((miniTab) => (
              <button
                type="button"
                key={miniTab.id}
                onClick={() => onMiniAppTabClick?.(miniTab.id)}
                className={`relative flex w-full items-center gap-2 rounded-xl py-[5px] pr-2.5 pl-7 text-[12px] transition-all duration-150 ${
                  activeTabId === miniTab.id
                    ? 'bg-cherry-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                }`}>
                {activeTabId === miniTab.id && (
                  <div className="pointer-events-none absolute inset-0 rounded-xl border border-cherry-active-border" />
                )}
                {activeTabId === miniTab.id && (
                  <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 flex items-center">
                    <div className="h-[24px] w-[10px] rounded-tl-[8px] rounded-bl-[8px] bg-cherry-glow-bg blur-[6px]" />
                    <div className="absolute right-0 h-[10px] w-[3px] rounded-[100px] bg-cherry-glow-line blur-[2px]" />
                  </div>
                )}
                <MiniAppIcon tab={miniTab} />
                <span className="truncate">{miniTab.title}</span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function FullDockedTabs({
  dockedTabs,
  activeTabId,
  onMiniAppTabClick,
  onStartSidebarDrag,
  onCloseDockedTab
}: {
  dockedTabs: SidebarTab[]
  activeTabId?: string
  onMiniAppTabClick?: (tabId: string) => void
  onStartSidebarDrag?: (e: React.MouseEvent, tabId: string) => void
  onCloseDockedTab?: (tabId: string) => void
}) {
  if (dockedTabs.length === 0) return null

  return (
    <div className="mt-1 space-y-0.5 border-border/30 border-t px-2 pt-1">
      {dockedTabs.map((dockedTab) => {
        const Icon = dockedTab.icon
        const isActive = activeTabId === dockedTab.id

        return (
          <div
            key={dockedTab.id}
            className={`group/dock relative flex cursor-grab items-center gap-2.5 rounded-xl px-2.5 py-[6px] text-[12px] transition-all duration-150 active:cursor-grabbing ${
              isActive
                ? 'bg-cherry-active-bg text-foreground'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            }`}
            onClick={() => onMiniAppTabClick?.(dockedTab.id)}
            onMouseDown={(event) => {
              event.stopPropagation()
              onStartSidebarDrag?.(event, dockedTab.id)
            }}>
            {isActive && (
              <div className="pointer-events-none absolute inset-0 rounded-xl border border-cherry-active-border" />
            )}
            {isActive && (
              <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 flex items-center">
                <div className="h-[24px] w-[10px] rounded-tl-[8px] rounded-bl-[8px] bg-cherry-glow-bg blur-[6px]" />
                <div className="absolute right-0 h-[10px] w-[3px] rounded-[100px] bg-cherry-glow-line blur-[2px]" />
              </div>
            )}
            {dockedTab.miniAppId ? (
              <MiniAppIcon tab={dockedTab} />
            ) : (
              <Icon size={14} strokeWidth={1.6} className="flex-shrink-0" />
            )}
            <span className="flex-1 truncate">{dockedTab.title}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onCloseDockedTab?.(dockedTab.id)
              }}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-foreground/10 group-hover/dock:opacity-100">
              <X size={9} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function SidebarBottomSection({
  extensionsLabel,
  onExtensionsClick,
  user,
  actions
}: {
  extensionsLabel: string
  onExtensionsClick?: () => void
  user?: SidebarUser
  actions?: React.ReactNode
}) {
  const userInitial = user?.initial ? user.initial : user?.name ? user.name.slice(0, 1).toUpperCase() : ''

  return (
    <div className="space-y-1 px-2 py-2">
      {extensionsLabel && (
        <button
          type="button"
          onClick={onExtensionsClick}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
          <Columns2 size={16} strokeWidth={1.6} />
          <span>{extensionsLabel}</span>
        </button>
      )}

      {actions}

      {user && (
        <div
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-accent/60"
          onClick={user.onClick}>
          <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-border">
            {user.avatarSrc ? (
              <img src={user.avatarSrc} alt={user.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-400 to-indigo-500 text-[10px] text-white">
                {userInitial}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-sidebar-foreground">{user.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">{user.email}</div>
          </div>
          <ChevronRight size={14} className="flex-shrink-0 text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

export interface SidebarProps {
  width: number
  setWidth: (width: number) => void
  activeItem: string
  items: SidebarMenuItem[]
  title?: string
  logo?: React.ReactNode
  activeMiniAppTabs?: SidebarTab[]
  activeTabId?: string
  dockedTabs?: SidebarTab[]
  user?: SidebarUser
  isFloating?: boolean
  searchLabel?: string
  extensionsLabel?: string
  actions?: React.ReactNode
  onItemClick: (id: string) => void
  onHoverChange?: (visible: boolean) => void
  onSearchClick?: () => void
  onExtensionsClick?: () => void
  onMiniAppTabClick?: (tabId: string) => void
  onStartSidebarDrag?: (e: React.MouseEvent, tabId: string) => void
  onCloseDockedTab?: (tabId: string) => void
  onDismiss?: () => void
}

export function Sidebar({
  width,
  setWidth,
  activeItem,
  items,
  title = '',
  logo,
  activeMiniAppTabs = [],
  activeTabId,
  dockedTabs = [],
  user,
  isFloating = false,
  searchLabel = '',
  extensionsLabel = '',
  actions,
  onItemClick,
  onHoverChange,
  onSearchClick,
  onExtensionsClick,
  onMiniAppTabClick,
  onStartSidebarDrag,
  onCloseDockedTab,
  onDismiss
}: SidebarProps) {
  const isResizing = useRef(false)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layout = getSidebarLayout(width)
  const showBottomSection = Boolean(extensionsLabel || user || onExtensionsClick || actions)
  const showSearch = Boolean(onSearchClick)

  // Cleanup pending timeouts and resize listeners on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
      resizeCleanupRef.current?.()
    }
  }, [])

  const startResizing = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      isResizing.current = true
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const containerLeft = sidebarRef.current?.parentElement?.getBoundingClientRect().left ?? 0

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return

        const nextWidth = moveEvent.clientX - containerLeft

        if (nextWidth < 15) setWidth(0)
        else if (nextWidth < 42) setWidth(SIDEBAR_ICON_WIDTH)
        else if (nextWidth < 90) setWidth(SIDEBAR_VERTICAL_CARD_WIDTH)
        else setWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_FULL_WIDTH, nextWidth)))
      }

      const cleanup = () => {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        resizeCleanupRef.current = null
      }

      const onMouseUp = () => cleanup()

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      resizeCleanupRef.current = cleanup
    },
    [setWidth]
  )

  const handleDismiss = useCallback(() => {
    onDismiss?.()
  }, [onDismiss])

  const logoNode = logo ?? <DefaultLogo title={title} />

  if (isFloating) {
    return (
      <div className="absolute inset-0 z-40" onClick={handleDismiss}>
        <div
          className="slide-in-from-left-2 absolute top-0 bottom-0 left-0 flex w-[170px] animate-in select-none flex-col rounded-r-[1px] bg-sidebar/70 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 duration-200"
          onClick={(event) => event.stopPropagation()}
          onMouseLeave={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
            hoverTimeout.current = setTimeout(handleDismiss, 300)
          }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
          }}>
          <div className="flex h-14 flex-shrink-0 items-center gap-2.5 px-4">
            {logoNode}
            <span className="truncate text-sidebar-foreground text-sm">{title}</span>
          </div>

          {showSearch && (
            <div className="px-3 py-2">
              <div
                onClick={() => {
                  onSearchClick?.()
                  handleDismiss()
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-sidebar-accent/50 px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent">
                <Search size={13} />
                <span>{searchLabel}</span>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
            <FullMenuItems
              items={items}
              activeItem={activeItem}
              onItemClick={onItemClick}
              activeMiniAppTabs={activeMiniAppTabs}
              activeTabId={activeTabId}
              onMiniAppTabClick={onMiniAppTabClick}
            />
            <FullDockedTabs
              dockedTabs={dockedTabs}
              activeTabId={activeTabId}
              onMiniAppTabClick={onMiniAppTabClick}
              onStartSidebarDrag={onStartSidebarDrag}
              onCloseDockedTab={onCloseDockedTab}
            />
          </div>

          {showBottomSection && (
            <div className="flex-shrink-0">
              <SidebarBottomSection
                extensionsLabel={extensionsLabel}
                onExtensionsClick={onExtensionsClick}
                user={user}
                actions={actions}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (layout === 'hidden') {
    return (
      <div ref={sidebarRef} className="relative h-full w-0 flex-shrink-0">
        <div
          className="absolute top-0 bottom-0 left-0 z-50 w-[16px]"
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
            <div className="ml-[2px] h-full w-[2px] rounded-full bg-primary/30 opacity-0 transition-opacity group-hover/handle:opacity-100" />
          </div>
        </div>
      </div>
    )
  }

  const actualWidth =
    layout === 'icon' ? SIDEBAR_ICON_WIDTH : layout === 'vertical-card' ? SIDEBAR_VERTICAL_CARD_WIDTH : width

  return (
    <div
      ref={sidebarRef}
      style={{ width: actualWidth }}
      className="group/sidebar relative z-20 flex h-full flex-shrink-0 select-none flex-col bg-sidebar">
      <div
        className={`flex flex-shrink-0 items-center ${layout === 'full' ? 'h-14 gap-2.5 px-4' : 'h-14 justify-center'}`}>
        {logoNode}
        {layout === 'full' && <span className="truncate text-sidebar-foreground text-sm">{title}</span>}
      </div>

      {showSearch &&
        (layout === 'full' ? (
          <div className="px-3 py-2">
            <div
              onClick={onSearchClick}
              className="flex cursor-pointer items-center gap-2 rounded-md bg-sidebar-accent px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent">
              <Search size={13} />
              <span>{searchLabel}</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1.5">
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

      <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
        {layout === 'icon' && (
          <div className="flex flex-col items-center gap-0.5 px-1.5">
            {items.map((item) => {
              const isActive = activeItem === item.id
              const Icon = item.icon
              const miniTabs = item.id === 'minapp' ? activeMiniAppTabs : []

              return (
                <div key={item.id} className="contents">
                  <SidebarTooltip content={item.label}>
                    <button
                      type="button"
                      onClick={() => onItemClick(item.id)}
                      className={`relative flex h-9 w-9 items-center justify-center rounded-md transition-all duration-150 ${
                        isActive
                          ? 'bg-cherry-active-bg text-foreground'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                      }`}>
                      {isActive && (
                        <div className="pointer-events-none absolute inset-0 rounded-md border border-cherry-active-border" />
                      )}
                      <Icon size={18} strokeWidth={1.6} />
                    </button>
                  </SidebarTooltip>

                  {miniTabs.map((miniTab) => (
                    <SidebarTooltip key={miniTab.id} content={miniTab.title}>
                      <button
                        type="button"
                        onClick={() => onMiniAppTabClick?.(miniTab.id)}
                        className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 ${
                          activeTabId === miniTab.id ? 'bg-cherry-active-bg' : 'hover:bg-accent/50'
                        }`}>
                        {activeTabId === miniTab.id && (
                          <div className="pointer-events-none absolute inset-0 rounded-md border border-cherry-active-border" />
                        )}
                        <MiniAppIcon tab={miniTab} size="md" />
                      </button>
                    </SidebarTooltip>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {layout === 'vertical-card' && (
          <div className="flex flex-col items-center gap-0 px-1">
            {items.map((item) => {
              const isActive = activeItem === item.id
              const Icon = item.icon
              const miniTabs = item.id === 'minapp' ? activeMiniAppTabs : []

              return (
                <div key={item.id} className="contents">
                  <button
                    type="button"
                    onClick={() => onItemClick(item.id)}
                    className={`relative flex w-full flex-col items-center gap-0.5 rounded-md py-2 transition-all duration-150 ${
                      isActive
                        ? 'bg-cherry-active-bg text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}>
                    {isActive && (
                      <div className="pointer-events-none absolute inset-0 rounded-md border border-cherry-active-border" />
                    )}
                    <Icon size={18} strokeWidth={1.6} />
                    <span className="text-[9px] leading-tight">{item.label}</span>
                  </button>

                  {miniTabs.map((miniTab) => (
                    <button
                      type="button"
                      key={miniTab.id}
                      onClick={() => onMiniAppTabClick?.(miniTab.id)}
                      className={`relative flex w-full flex-col items-center gap-0.5 rounded-md py-1.5 transition-all duration-150 ${
                        activeTabId === miniTab.id ? 'bg-cherry-active-bg' : 'hover:bg-accent/40'
                      }`}>
                      {activeTabId === miniTab.id && (
                        <div className="pointer-events-none absolute inset-0 rounded-md border border-cherry-active-border" />
                      )}
                      <MiniAppIcon tab={miniTab} size="md" />
                      <span className="max-w-[50px] truncate text-[8px] text-muted-foreground leading-tight">
                        {miniTab.title}
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {layout === 'full' && (
          <FullMenuItems
            items={items}
            activeItem={activeItem}
            onItemClick={onItemClick}
            activeMiniAppTabs={activeMiniAppTabs}
            activeTabId={activeTabId}
            onMiniAppTabClick={onMiniAppTabClick}
          />
        )}

        {dockedTabs.length > 0 && (
          <div>
            {layout === 'icon' && (
              <div className="mt-1 flex flex-col items-center gap-0.5 border-border/30 border-t px-1.5 pt-1">
                {dockedTabs.map((dockedTab) => {
                  const Icon = dockedTab.icon
                  const isActive = activeTabId === dockedTab.id

                  return (
                    <div key={dockedTab.id} className="group/dock relative">
                      <SidebarTooltip content={dockedTab.title}>
                        <button
                          type="button"
                          onClick={() => onMiniAppTabClick?.(dockedTab.id)}
                          onMouseDown={(event) => {
                            event.stopPropagation()
                            onStartSidebarDrag?.(event, dockedTab.id)
                          }}
                          className={`relative flex h-7 w-7 cursor-grab items-center justify-center rounded-md transition-all duration-150 active:cursor-grabbing ${
                            isActive ? 'bg-cherry-active-bg' : 'hover:bg-accent/50'
                          }`}>
                          {isActive && (
                            <div className="pointer-events-none absolute inset-0 rounded-md border border-cherry-active-border" />
                          )}
                          {dockedTab.miniAppId ? (
                            <MiniAppIcon tab={dockedTab} size="md" />
                          ) : (
                            <Icon size={14} strokeWidth={1.6} />
                          )}
                        </button>
                      </SidebarTooltip>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onCloseDockedTab?.(dockedTab.id)
                        }}
                        className="-right-1 -top-1 absolute z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/dock:opacity-100">
                        <X size={7} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {layout === 'vertical-card' && (
              <div className="mt-1 flex flex-col items-center gap-0 border-border/30 border-t px-1 pt-1">
                {dockedTabs.map((dockedTab) => {
                  const Icon = dockedTab.icon
                  const isActive = activeTabId === dockedTab.id

                  return (
                    <div key={dockedTab.id} className="group/dock relative w-full">
                      <button
                        type="button"
                        onClick={() => onMiniAppTabClick?.(dockedTab.id)}
                        onMouseDown={(event) => {
                          event.stopPropagation()
                          onStartSidebarDrag?.(event, dockedTab.id)
                        }}
                        className={`relative flex w-full cursor-grab flex-col items-center gap-0.5 rounded-md py-1.5 transition-all duration-150 active:cursor-grabbing ${
                          isActive ? 'bg-cherry-active-bg' : 'hover:bg-accent/40'
                        }`}>
                        {isActive && (
                          <div className="pointer-events-none absolute inset-0 rounded-md border border-cherry-active-border" />
                        )}
                        {dockedTab.miniAppId ? (
                          <MiniAppIcon tab={dockedTab} size="md" />
                        ) : (
                          <Icon size={18} strokeWidth={1.6} />
                        )}
                        <span className="max-w-[50px] truncate text-[8px] text-muted-foreground leading-tight">
                          {dockedTab.title}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onCloseDockedTab?.(dockedTab.id)
                        }}
                        className="absolute top-0.5 right-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/dock:opacity-100">
                        <X size={7} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {layout === 'full' && (
              <FullDockedTabs
                dockedTabs={dockedTabs}
                activeTabId={activeTabId}
                onMiniAppTabClick={onMiniAppTabClick}
                onStartSidebarDrag={onStartSidebarDrag}
                onCloseDockedTab={onCloseDockedTab}
              />
            )}
          </div>
        )}
      </div>

      {showBottomSection && (
        <div className="flex-shrink-0">
          {layout === 'icon' && (
            <div className="flex flex-col items-center gap-1 px-1.5 py-2">
              {extensionsLabel && (
                <SidebarTooltip content={extensionsLabel}>
                  <button
                    type="button"
                    onClick={onExtensionsClick}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
                    <Columns2 size={18} strokeWidth={1.6} />
                  </button>
                </SidebarTooltip>
              )}
              {actions}
              {user && (
                <div
                  className="h-7 w-7 cursor-pointer overflow-hidden rounded-full ring-1 ring-border"
                  onClick={user.onClick}>
                  {user.avatarSrc ? (
                    <img src={user.avatarSrc} alt={user.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-400 to-indigo-500 text-[10px] text-white">
                      {user.initial ? user.initial : user.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {layout === 'vertical-card' && (
            <div className="flex flex-col items-center gap-0 px-1 py-1.5">
              {extensionsLabel && (
                <button
                  type="button"
                  onClick={onExtensionsClick}
                  className="flex w-full flex-col items-center gap-0.5 rounded-lg py-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
                  <Columns2 size={18} strokeWidth={1.6} />
                  <span className="text-[9px] leading-tight">{extensionsLabel}</span>
                </button>
              )}
              {actions}
              {user && (
                <div
                  className="mt-1 h-7 w-7 cursor-pointer overflow-hidden rounded-full ring-1 ring-border"
                  onClick={user.onClick}>
                  {user.avatarSrc ? (
                    <img src={user.avatarSrc} alt={user.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-400 to-indigo-500 text-[10px] text-white">
                      {user.initial ? user.initial : user.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {layout === 'full' && (
            <SidebarBottomSection
              extensionsLabel={extensionsLabel}
              onExtensionsClick={onExtensionsClick}
              user={user}
              actions={actions}
            />
          )}
        </div>
      )}

      <div
        onMouseDown={startResizing}
        className="group/handle absolute top-0 right-0 bottom-0 z-50 w-[3px] cursor-col-resize">
        <div className="h-full w-full bg-primary/20 opacity-0 transition-opacity group-hover/handle:opacity-100" />
      </div>
    </div>
  )
}
