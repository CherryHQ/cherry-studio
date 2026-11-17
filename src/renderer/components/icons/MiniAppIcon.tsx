import type { FC } from 'react'

import { getProviderIconAssetMetrics } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { getMiniAppsLogoRef, useMiniAppLogo } from '@renderer/components/icons/miniAppsLogo'
import type { MiniApp } from '@shared/data/types/miniApp'

import { getIconDisplayConfig } from './iconDisplayConfig'

interface Props {
  app: Pick<MiniApp, 'logo' | 'logoSrc' | 'name' | 'background'>
  /** `avatar` keeps bordered Avatar chrome; `plain` uses launchpad sizing; `bare` removes chrome; `sidebar` is circular. */
  appearance?: 'avatar' | 'plain' | 'bare' | 'sidebar'
  /** Visible artwork target for inset registry icons rendered without chrome. */
  artworkSize?: number
  size?: number
  style?: React.CSSProperties
}

const MiniAppIcon: FC<Props> = ({ app, appearance = 'avatar', artworkSize, size = 48, style }) => {
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
          className={`flex shrink-0 items-center justify-center ${appearance === 'sidebar' ? 'overflow-hidden rounded-full' : ''}`}
          style={{ width: `${size}px`, height: `${size}px`, userSelect: 'none', ...style }}
        />
      )
    }
    if (appearance === 'sidebar') {
      const displayConfig = getIconDisplayConfig('mini-app', logoRef.meta.id)
      const iconScale = displayConfig?.scale ?? 1
      const iconSize = size * iconScale

      return (
        <span
          className="flex shrink-0 items-center justify-center overflow-hidden rounded-full"
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
      const displayConfig = getIconDisplayConfig('mini-app', logoRef.meta.id)
      const metrics =
        appearance === 'bare' && artworkSize !== undefined
          ? getProviderIconAssetMetrics({ kind: logoRef.kind, iconId: logoRef.meta.id })
          : undefined
      const iconSize =
        metrics && artworkSize !== undefined ? artworkSize * metrics.canvasScale : size * (displayConfig?.scale ?? 1)

      return (
        <span
          className={cn(
            'flex shrink-0 items-center justify-center',
            appearance === 'plain' &&
              '[--icon-neutral-background:var(--muted)] dark:[--icon-neutral-background:initial]'
          )}
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
              borderRadius: appearance === 'plain' ? displayConfig?.borderRadius : undefined,
              overflow: appearance === 'plain' && displayConfig?.borderRadius !== undefined ? 'hidden' : undefined
            }}
          />
        </span>
      )
    }

    return <Icon.Avatar size={size} className="select-none" shape="rounded" />
  }

  if (src) {
    if (appearance === 'bare') {
      return (
        <img
          src={src}
          className="shrink-0 object-contain select-none"
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

    return (
      <img
        src={src}
        className={
          appearance === 'plain' ? 'shrink-0 object-cover select-none' : 'rounded-2xl border border-border select-none'
        }
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
