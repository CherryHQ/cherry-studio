import { getMiniAppsLogo } from '@renderer/config/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC } from 'react'

interface Props {
  app: MiniApp
  sidebar?: boolean
  size?: number
  style?: React.CSSProperties
}

const MiniAppIcon: FC<Props> = ({ app, size = 48, style, sidebar = false }) => {
  // app prop already has merged preset fields (logo, bordered, background, style) via mergeWithPreset
  if (app.logo) {
    const logo = getMiniAppsLogo(app.logo)

    // CompoundIcon: render its Avatar sub-component
    if (logo && typeof logo !== 'string') {
      const Icon = logo
      return <Icon.Avatar size={size} className="select-none" shape="rounded" />
    }

    return (
      <img
        src={typeof logo === 'string' ? logo : app.logo}
        className="select-none rounded-2xl"
        style={{
          border: app.bordered ? '0.5px solid var(--color-border)' : 'none',
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: app.background,
          userSelect: 'none',
          ...(sidebar ? {} : undefined),
          ...style
        }}
        draggable={false}
        alt={app.name || 'MiniApp Icon'}
      />
    )
  }

  return null
}

export default MiniAppIcon
