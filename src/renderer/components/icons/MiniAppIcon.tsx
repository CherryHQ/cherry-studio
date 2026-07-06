import { getMiniAppsLogo } from '@renderer/components/icons/miniAppsLogo'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC } from 'react'

interface Props {
  app: Pick<MiniApp, 'logo' | 'logoSrc' | 'name' | 'background'>
  /** `avatar` keeps the bordered Avatar chrome; `plain` strips it from icon logos; `bare` also strips it from image logos. */
  appearance?: 'avatar' | 'plain' | 'bare'
  size?: number
  style?: React.CSSProperties
}

const MiniAppIcon: FC<Props> = ({ app, appearance = 'avatar', size = 48, style }) => {
  // A preset key resolves to a CompoundIcon; an uploaded logo arrives as a
  // ready `logoSrc` URL (or a pre-resolved url on `logo` for sidebar tabs).
  const compound = app.logo ? getMiniAppsLogo(app.logo) : undefined
  const src = app.logoSrc ?? app.logo

  // CompoundIcon: default usages keep the Avatar wrapper; Launchpad-style tiles render the logo itself.
  if (compound) {
    const Icon = compound
    if (appearance === 'plain' || appearance === 'bare') {
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

  if (src) {
    if (appearance === 'bare') {
      return (
        <img
          src={src}
          className="shrink-0 select-none object-contain"
          style={{ width: `${size}px`, height: `${size}px`, userSelect: 'none', ...style }}
          draggable={false}
          alt={app.name || 'MiniApp Icon'}
        />
      )
    }

    return (
      <img
        src={src}
        className="select-none rounded-2xl border border-border"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: app.background,
          userSelect: 'none',
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
