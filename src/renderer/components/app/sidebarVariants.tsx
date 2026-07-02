import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import { getSidebarFavoriteKey, getSidebarMenuPath } from '@renderer/utils/sidebar'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import type { MiniApp } from '@shared/data/types/miniApp'

import { MiniAppIcon } from '../Sidebar/primitives'
import type { ResolvedSidebarEntry } from '../Sidebar/types'
import { SIDEBAR_ICON_COMPONENTS } from './sidebarIcons'

/** Exhaustiveness guard: a new `SidebarFavoriteItem` type must add a `case` below. */
function assertNever(value: never): never {
  throw new Error(`Unhandled sidebar favorite variant: ${JSON.stringify(value)}`)
}

/**
 * Runtime context a variant needs to resolve a favorite into a rendered row:
 * i18n, route inputs, installed mini app data, and the open/remove callbacks the
 * container owns.
 */
export interface SidebarVariantContext {
  t: (key: string) => string
  defaultPaintingProvider: string
  installedMiniApps: Map<string, MiniApp>
  isRequiredApp: (id: SidebarAppId) => boolean
  openApp: (id: SidebarAppId) => void
  openMiniApp: (id: string) => void
  removeApp: (id: SidebarAppId) => void
  removeMiniApp: (id: string) => void
}

/**
 * One sidebar item type's whole behavior in a single object: how a stored
 * favorite of that type resolves into a rendered, type-agnostic row (icon, label,
 * active-match, open action, context menu), or `null` when it is not renderable
 * (missing icon/route, or an uninstalled mini app). Adding a new sidebar item type
 * = one new descriptor here plus a `case` in `resolveSidebarEntry`.
 */
interface SidebarVariantDescriptor<T extends SidebarFavoriteItem> {
  resolve: (item: T, ctx: SidebarVariantContext) => ResolvedSidebarEntry | null
}

const appVariant: SidebarVariantDescriptor<Extract<SidebarFavoriteItem, { type: 'app' }>> = {
  resolve: (item, ctx) => {
    const id = item.id
    const path = getSidebarMenuPath(id, ctx.defaultPaintingProvider)
    const Icon = SIDEBAR_ICON_COMPONENTS[id]
    // Unrenderable app (no route or no icon) is dropped from the list but stays in
    // the preference.
    if (!path || !Icon) return null

    return {
      key: getSidebarFavoriteKey(item),
      label: ctx.t(getSidebarIconLabelKey(id)),
      renderIcon: (size) => <Icon size={size} strokeWidth={1.6} />,
      isActive: (active) => active.activeItem === id,
      onOpen: () => ctx.openApp(id),
      contextMenuItems: [
        {
          type: 'item',
          id: `sidebar.remove-app.${id}`,
          label: ctx.t('launchpad.unpin_from_sidebar'),
          enabled: !ctx.isRequiredApp(id),
          onSelect: () => ctx.removeApp(id)
        }
      ]
    }
  }
}

const miniAppVariant: SidebarVariantDescriptor<Extract<SidebarFavoriteItem, { type: 'mini_app' }>> = {
  resolve: (item, ctx) => {
    const app = ctx.installedMiniApps.get(item.id)
    // Stale mini app (no matching installed app) is dropped from the list but stays
    // in the preference.
    if (!app) return null

    const title = app.nameKey ? ctx.t(app.nameKey) : app.name
    const tab = {
      id: app.appId,
      title,
      type: 'miniapp' as const,
      miniApp: { id: app.appId, logo: app.logo, url: app.url }
    }

    return {
      key: getSidebarFavoriteKey(item),
      label: title,
      renderIcon: (_size, miniAppSize) => <MiniAppIcon tab={tab} size={miniAppSize} />,
      isActive: (active) => active.activeTabId === app.appId,
      onOpen: () => ctx.openMiniApp(app.appId),
      contextMenuItems: [
        {
          type: 'item',
          id: `sidebar.remove-mini-app.${app.appId}`,
          label: ctx.t('launchpad.unpin_from_sidebar'),
          onSelect: () => ctx.removeMiniApp(app.appId)
        }
      ]
    }
  }
}

/**
 * Resolve one stored favorite into a rendered row via its variant descriptor, or
 * `null` when it is not renderable. The single dispatch here is the only place
 * that switches on the favorite type; every type-specific detail lives in the
 * descriptor above. The `assertNever` default makes adding a `SidebarFavoriteItem`
 * type a compile error until a `case` is added.
 */
export function resolveSidebarEntry(
  favorite: SidebarFavoriteItem,
  ctx: SidebarVariantContext
): ResolvedSidebarEntry | null {
  switch (favorite.type) {
    case 'app':
      return appVariant.resolve(favorite, ctx)
    case 'mini_app':
      return miniAppVariant.resolve(favorite, ctx)
    default:
      return assertNever(favorite)
  }
}
