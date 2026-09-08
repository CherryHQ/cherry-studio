import { getMiniAppsLogoRef, useMiniAppLogo } from '@renderer/components/icons/miniAppsLogo'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC } from 'react'

import { getIconDisplayConfig, miniAppContainedIcon } from './iconDisplayConfig'

interface Props {
  app: Pick<MiniApp, 'logo' | 'logoSrc' | 'name' | 'background'>
  /** `avatar` keeps bordered Avatar chrome; `plain` uses launchpad sizing; `bare` is raw; `sidebar` is circular. */
  appearance?: 'avatar' | 'plain' | 'bare' | 'sidebar'
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
          className={`flex shrink-0 items-center justify-center ${appearance === 'sidebar' ? 'overflow-hidden rounded-full border border-transparent bg-white/90 dark:border-border dark:bg-transparent' : ''}`}
          style={{ width: `${size}px`, height: `${size}px`, userSelect: 'none', ...style }}
        />
      )
    }
    if (appearance === 'sidebar') {
      const displayConfig = getIconDisplayConfig('mini-app', app.logo)
      if (displayConfig?.scale && displayConfig.scale < 1) {
        return <Icon.Avatar size={size} className="select-none" shape="circle" />
      }

      const iconScale = app.logo?.toLowerCase() === 'bolt' ? 1.3 : (displayConfig?.scale ?? 1)
      const iconSize = size * iconScale

      return (
        <span
          className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-transparent bg-white/90 dark:border-border dark:bg-transparent"
          style={{ width: `${size}px`, height: `${size}px`, userSelect: 'none', ...style }}>
          <Icon
            aria-label={app.name || 'MiniApp Icon'}
            className="select-none"
            style={{ width: `${iconSize}px`, height: `${iconSize}px`, flexShrink: 0 }}
          />
        </span>
      )
    }
    if (appearance === 'plain' || appearance === 'bare') {
      const displayConfig = appearance === 'plain' ? getIconDisplayConfig('mini-app', app.logo) : undefined
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
              flexShrink: 0,
              borderRadius: displayConfig?.borderRadius === undefined ? undefined : `${displayConfig.borderRadius}px`,
              overflow: displayConfig?.borderRadius === undefined ? undefined : 'hidden'
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
    if (appearance === 'sidebar') {
      return (
        <span
          className="flex shrink-0 items-center justify-center"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            userSelect: 'none',
            ...style
          }}>
          <img
            src={src}
            className="shrink-0 select-none rounded-full object-cover"
            style={{ width: `${size}px`, height: `${size}px` }}
            draggable={false}
            alt={app.name || 'MiniApp Icon'}
          />
        </span>
      )
    }

    const imageDisplayConfig = appearance === 'plain' ? miniAppContainedIcon : undefined
    const imageSize = size * (imageDisplayConfig?.scale ?? 1)

    return (
      <img
        src={src}
        className={appearance === 'plain' ? 'select-none' : 'select-none rounded-2xl border border-border'}
        style={{
          width: `${imageSize}px`,
          height: `${imageSize}px`,
          borderRadius:
            imageDisplayConfig?.borderRadius === undefined ? undefined : `${imageDisplayConfig.borderRadius}px`,
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
