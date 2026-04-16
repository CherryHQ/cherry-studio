import { allMinApps } from '@renderer/config/minapps'
import { getMiniAppsLogo } from '@renderer/config/minapps'
import type { MinAppType } from '@renderer/types'
import type { FC } from 'react'

interface Props {
  app: MinAppType
  sidebar?: boolean
  size?: number
  style?: React.CSSProperties
}

const MinAppIcon: FC<Props> = ({ app, size = 48, style, sidebar = false }) => {
  // First try to find in allMinApps for predefined styling
  const _app = allMinApps.find((item) => item.id === app.id)

  // If found in allMinApps, use predefined styling
  if (_app) {
    const logo = getMiniAppsLogo(_app.logo)

    // CompoundIcon: render its Avatar sub-component
    if (logo && typeof logo !== 'string') {
      const Icon = logo
      return <Icon.Avatar size={size} className="select-none" shape="rounded" />
    }

    return (
      <img
        src={logo}
        className="select-none rounded-2xl"
        style={{
          border: _app.bordered ? '0.5px solid var(--color-border)' : 'none',
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: _app.background,
          userSelect: 'none',
          ...(sidebar ? {} : app.style),
          ...style
        }}
        draggable={false}
        alt={app.name || 'MinApp Icon'}
      />
    )
  }

  // If not found in allMinApps but app has logo, use it (for temporary apps)
  if (app.logo) {
    return (
      <img
        src={app.logo}
        className="select-none rounded-2xl"
        style={{
          border: 'none',
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: 'transparent',
          userSelect: 'none',
          ...(sidebar ? {} : app.style),
          ...style
        }}
        draggable={false}
        alt={app.name || 'MinApp Icon'}
      />
    )
  }

  return null
}

export default MinAppIcon
