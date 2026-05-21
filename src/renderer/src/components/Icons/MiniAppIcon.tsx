import { getMiniAppsLogo } from '@renderer/config/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC } from 'react'

interface Props {
  app: MiniApp
  appearance?: 'avatar' | 'plain'
  sidebar?: boolean
  size?: number
  style?: React.CSSProperties
}

const MiniAppIcon: FC<Props> = ({ app, appearance = 'avatar', size = 48, style, sidebar = false }) => {
  // app prop already has merged preset fields (logo, bordered, background, style) via mergeWithPreset
  if (app.logo) {
    const logo = getMiniAppsLogo(app.logo)

    // CompoundIcon: default usages keep the Avatar wrapper; Launchpad-style tiles render the logo itself.
    if (logo && typeof logo !== 'string') {
      const Icon = logo
      if (appearance === 'plain') {
        return (
          <span
            className="flex shrink-0 items-center justify-center"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              userSelect: 'none',
              ...style
            }}>
            <Icon
              aria-label={app.name || 'MiniApp Icon'}
              className="select-none"
              style={{ width: `${size}px`, height: `${size}px` }}
            />
          </span>
        )
      }

      return <Icon.Avatar size={size} className="select-none border border-border" shape="rounded" />
    }

    return (
      <img
        src={typeof logo === 'string' ? logo : app.logo}
        className="select-none rounded-2xl border border-border"
        style={{
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
