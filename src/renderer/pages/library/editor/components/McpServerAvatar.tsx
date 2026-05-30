import type { MCPServer } from '@shared/data/types/mcpServer'
import { type LucideIcon, Wrench } from 'lucide-react'

interface McpServerAvatarProps {
  server: MCPServer
  size: number
  fallbackIcon?: LucideIcon
  fallbackIconClassName?: string
  fallbackIconScale?: number
}

export function McpServerAvatar({
  server,
  size,
  fallbackIcon: FallbackIcon = Wrench,
  fallbackIconClassName = 'text-foreground/70',
  fallbackIconScale = 0.45
}: McpServerAvatarProps) {
  if (server.logoUrl) {
    return (
      <img
        src={server.logoUrl}
        alt=""
        className="shrink-0 rounded-2xs bg-accent/40 object-cover"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-2xs bg-accent/50"
      style={{ width: size, height: size }}>
      <FallbackIcon size={Math.round(size * fallbackIconScale)} strokeWidth={1.4} className={fallbackIconClassName} />
    </div>
  )
}
