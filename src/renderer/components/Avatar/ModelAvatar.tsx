import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { getIconWebpUrl, useIcon } from '@cherrystudio/ui/icons'
import { useTheme } from '@renderer/hooks/useTheme'
import { getModelLogoRef } from '@renderer/utils/model'
import { cn } from '@renderer/utils/style'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { first } from 'es-toolkit/compat'
import type { FC, ReactNode } from 'react'

/**
 * Structural minimum the avatar needs. `getModelLogoRef` is shape-agnostic
 * (accepts both v1 `provider` and v2 `providerId`), so this component works
 * with either Model shape — no v1 `@renderer/types` dependency.
 */
interface AvatarModel {
  id: string
  name: string
  provider?: string
  providerId?: string
}

interface Props {
  model?: AvatarModel
  size: number
  className?: string
  fallback?: ReactNode
}

const ModelAvatar: FC<Props> = ({ model, size, className, fallback = first(model?.name) }) => {
  const { theme } = useTheme()
  const iconRef = getModelLogoRef(model)
  const webpUrl = getIconWebpUrl(iconRef, theme === ThemeMode.dark ? 'dark' : 'light')
  const Icon = useIcon(webpUrl ? undefined : iconRef)

  if (webpUrl) {
    return (
      <Avatar className={className} style={{ width: size, height: size }}>
        <AvatarImage alt="" className="bg-background object-contain" draggable={false} src={webpUrl} />
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>
    )
  }

  if (Icon) {
    return <Icon.Avatar size={size} className={className} />
  }
  return (
    <Avatar
      className={cn('flex items-center justify-center rounded-lg', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="rounded-lg">{fallback}</AvatarFallback>
    </Avatar>
  )
}

export default ModelAvatar
