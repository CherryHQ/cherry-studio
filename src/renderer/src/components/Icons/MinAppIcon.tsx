import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import type { MinAppType } from '@renderer/types'
import type { FC } from 'react'

interface Props {
  app: MinAppType
  sidebar?: boolean
  size?: number
  style?: React.CSSProperties
}

const MinAppIcon: FC<Props> = ({ app, size = 48, style, sidebar = false }) => {
  // First try to find in DEFAULT_MIN_APPS for predefined styling
  const _app = DEFAULT_MIN_APPS.find((item) => item.id === app.id)

  // If found in DEFAULT_MIN_APPS, use predefined styling
  if (_app) {
    return (
      <img
        src={_app.logo}
        className="select-none rounded-2xl"
        style={{
          border: _app.bodered ? '0.5px solid var(--color-border)' : 'none',
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

  // If not found in DEFAULT_MIN_APPS but app has logo, use it (for temporary apps)
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
