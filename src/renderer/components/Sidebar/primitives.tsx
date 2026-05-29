import { LogoAvatar } from '@renderer/components/Icons'
import type { LucideProps } from 'lucide-react'

import type { SidebarMiniAppTab, SidebarTab, SidebarUser } from './types'

export function ActiveIndicator({ className, glow = false }: { className?: string; glow?: boolean }) {
  return (
    <>
      <div className={`pointer-events-none absolute inset-0 border border-sidebar-active-border ${className ?? ''}`} />
      {glow && (
        <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 flex items-center">
          <div className="h-[24px] w-[10px] rounded-tl-[8px] rounded-bl-[8px] bg-sidebar-glow-bg blur-[6px]" />
          <div className="absolute right-0 h-[10px] w-[3px] rounded-[100px] bg-sidebar-glow-line blur-[2px]" />
        </div>
      )}
    </>
  )
}

export function DefaultLogo({ title }: { title: string }) {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15 font-medium text-primary text-sm">
      {title ? title.slice(0, 1).toUpperCase() : ''}
    </div>
  )
}

export function MiniAppIcon({ tab, size = 'sm' }: { tab: SidebarMiniAppTab; size?: 'sm' | 'md' }) {
  const pixelSize = size === 'sm' ? 14 : 16
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const fontSize = size === 'sm' ? 'text-[6px]' : 'text-[8px]'
  const { miniApp } = tab

  if (miniApp.logo) {
    return <LogoAvatar logo={miniApp.logo} size={pixelSize} shape="rounded" />
  }

  return (
    <div
      className={`${iconSize} ${fontSize} flex flex-shrink-0 items-center justify-center rounded-[3px] text-white`}
      style={{ background: miniApp.color ?? 'transparent' }}>
      {tab.title?.[0] ?? ''}
    </div>
  )
}

export function SidebarTabIcon({
  tab,
  miniAppSize = 'sm',
  ...iconProps
}: { tab: SidebarTab; miniAppSize?: 'sm' | 'md' } & LucideProps) {
  if (tab.type === 'miniapp') {
    return <MiniAppIcon tab={tab} size={miniAppSize} />
  }
  const Icon = tab.icon
  return <Icon {...iconProps} />
}

/** Returns true if the string is NOT a URL — i.e., should be rendered as text (emoji or initial). */
function isTextAvatar(str?: string): boolean {
  if (!str || str.startsWith('data:') || str.startsWith('http') || str.startsWith('/') || str.startsWith('blob:')) {
    return false
  }
  return true
}

function getUserAvatarFallback(user?: SidebarUser) {
  if (user?.avatar && isTextAvatar(user.avatar)) return user.avatar
  return user?.name ? user.name.slice(0, 1).toUpperCase() : ''
}

export function UserAvatar({ user, className }: { user: SidebarUser; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-full ring-1 ring-border ${className ?? ''}`}>
      {user.avatar && !isTextAvatar(user.avatar) ? (
        <img src={user.avatar} alt={user.name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-400 to-indigo-500 text-[10px] text-white">
          {getUserAvatarFallback(user)}
        </div>
      )}
    </div>
  )
}
