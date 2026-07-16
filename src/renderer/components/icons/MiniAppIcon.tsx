import { getMiniAppsLogoRef, useMiniAppLogo } from '@renderer/components/icons/miniAppsLogo'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC } from 'react'

import { getMiniAppIconDisplayConfig } from './miniAppIcon.config'

interface Props {
  app: Pick<MiniApp, 'logo' | 'logoSrc' | 'name' | 'background'>
  /** `avatar` keeps the bordered Avatar chrome; `plain` strips it from icon logos; `bare` also strips it from image logos. */
  appearance?: 'avatar' | 'plain' | 'bare'
  size?: number
  style?: React.CSSProperties
}

const MiniAppIcon: FC<Props> = ({ app, appearance = 'avatar', size = 48, style }) => {
  // Branching is decided synchronously from the ref; the CompoundIcon itself
  // loads async — a size-stable placeholder covers the brief loading window.
  const logoRef = getMiniAppsLogoRef(app.logo || undefined)
  const Icon = useMiniAppLogo(app.logo || undefined)

  // A preset key resolves to a CompoundIcon; an uploaded logo arrives as a
  // ready `logoSrc` URL (or a pre-resolved url on `logo` for sidebar tabs).
  const src = app.logoSrc ?? app.logo

  // CompoundIcon: default usages keep the Avatar wrapper; Launchpad-style tiles render the logo itself.
  if (logoRef) {
    if (!Icon) {
      return (
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: `${size}px`, height: `${size}px`, userSelect: 'none', ...style }}
        />
      )
    }
    if (appearance === 'plain' || appearance === 'bare') {
      const displayConfig = appearance === 'plain' ? getMiniAppIconDisplayConfig(app.logo) : undefined
      const iconSize = size * (displayConfig?.scale ?? 1)

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
            style={{
              width: `${iconSize}px`,
              height: `${iconSize}px`,
              borderRadius: displayConfig ? `${displayConfig.borderRadius}px` : undefined,
              overflow: displayConfig ? 'hidden' : undefined
            }}
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
