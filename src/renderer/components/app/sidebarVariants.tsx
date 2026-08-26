import { renderAgentEntityIcon, renderAssistantEntityIcon } from '@renderer/components/chat/resourceList/base'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import type { Assistant } from '@renderer/types/assistant'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import { getSidebarFavoriteKey, getSidebarMenuPath, isSidebarAppId } from '@renderer/utils/sidebar'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AssistantIconType, SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import type { MiniApp } from '@shared/data/types/miniApp'

import { MiniAppIcon, type ResolvedSidebarEntry } from '../Sidebar'
import { SIDEBAR_ICON_COMPONENTS } from './sidebarIcons'

/** Exhaustiveness guard: a new `SidebarFavoriteItem` type must add a `case` below. */
function assertNever(value: never): never {
  throw new Error(`Unhandled sidebar favorite variant: ${JSON.stringify(value)}`)
}

/** A sidebar row is only identifiable by its icon, so 'none' degrades to the emoji. */
function sidebarIconType(iconType: AssistantIconType): AssistantIconType {
  return iconType === 'none' ? 'emoji' : iconType
}

// Entity icons are filled discs like mini app logos, not line glyphs, so they follow
// the mini app scale — the lucide `size` renders them visibly smaller than their row.
const ENTITY_ICON_PIXEL_SIZE = { md: 18, lg: 24 } as const

/**
 * Runtime context a variant needs to resolve a favorite into a rendered row:
 * i18n, route inputs, installed mini app data, and the open/remove callbacks the
 * container owns.
 */
export interface SidebarVariantContext {
  t: (key: string) => string
  defaultPaintingProvider: string
  installedMiniApps: Map<string, MiniApp>
  installedAgents: Map<string, AgentEntity>
  installedAssistants: Map<string, Assistant>
  /** Icon-type preferences, so pinned rows match what the assistant / agent rails show. */
  assistantIconType: AssistantIconType
  agentIconType: AssistantIconType
  defaultModelId: string | null
  isRequiredApp: (id: SidebarAppId) => boolean
  openApp: (id: SidebarAppId, options?: { inNewTab?: boolean }) => void
  openMiniApp: (id: string, options?: { inNewTab?: boolean }) => void
  openAgent: (id: string, options?: { inNewTab?: boolean }) => void
  openAssistant: (id: string, options?: { inNewTab?: boolean }) => void
  removeApp: (id: SidebarAppId) => void
  removeMiniApp: (id: string) => void
  removeAgent: (id: string) => void
  removeAssistant: (id: string) => void
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
    if (!isSidebarAppId(id)) return null
    const path = getSidebarMenuPath(id, ctx.defaultPaintingProvider)
    const Icon = SIDEBAR_ICON_COMPONENTS[id]
    // Unrenderable app (no route or no icon) is dropped from the list but stays in
    // the preference.
    if (!path || !Icon) return null

    return {
      key: getSidebarFavoriteKey(item),
      label: ctx.t(getSidebarIconLabelKey(id)),
      renderIcon: (size) => <Icon size={size} strokeWidth={1.6} />,
      isOpen: () => false,
      isCurrent: (state) => state.activeItem === id,
      onOpen: () => ctx.openApp(id),
      onOpenNewTab: () => ctx.openApp(id, { inNewTab: true }),
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
      title,
      // Uploaded logo → main-resolved `logoSrc`; preset key → `logo`.
      miniApp: { id: app.appId, logo: app.logoSrc ?? app.logo, url: app.url }
    }

    return {
      key: getSidebarFavoriteKey(item),
      label: title,
      renderIcon: (_size, miniAppSize) => <MiniAppIcon tab={tab} size={miniAppSize} />,
      // A mini app route keeps its id in the URL, so its tabs need no ownership tag.
      isOpen: (state) => state.tabs?.some((tab) => miniAppIdFromTabUrl(tab.url) === app.appId) ?? false,
      isCurrent: (state) => miniAppIdFromTabUrl(state.currentTab?.url) === app.appId,
      onOpen: () => ctx.openMiniApp(app.appId),
      onOpenNewTab: () => ctx.openMiniApp(app.appId),
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

/** A conversation tab carrying an entity-ownership tag (see `openConversationTab`). */
export interface ConversationEntryTag {
  type: 'agent' | 'assistant'
  entityId: string
}

/**
 * Whether a tab belongs to this entity — the single ownership test behind both
 * `isOpen` / `isCurrent` and the click handler. A tab
 * is tagged with its owning entity at open time (its URL is rewritten to
 * sessionId/topicId by the route interceptor, so the URL cannot carry the entity
 * id back). Route tabs opened from a conversation history (history link, search)
 * have no tag and never highlight.
 */
export function isTabForConversationEntry(tab: unknown, entry: ConversationEntryTag): boolean {
  const metadata = (tab as { metadata?: { conversationEntry?: ConversationEntryTag } } | null)?.metadata
  return metadata?.conversationEntry?.type === entry.type && metadata.conversationEntry.entityId === entry.entityId
}

const agentVariant: SidebarVariantDescriptor<Extract<SidebarFavoriteItem, { type: 'agent' }>> = {
  resolve: (item, ctx) => {
    const agent = ctx.installedAgents.get(item.id)
    // Stale agent (deleted) is dropped from the list but stays in the preference.
    if (!agent) return null

    return {
      key: getSidebarFavoriteKey(item),
      label: agent.name,
      // Same renderer the agent rail uses, so a pinned row matches the list it came from.
      // 'none' would leave the row with no glyph at all, so the sidebar keeps the emoji there.
      renderIcon: (_size, iconSize) =>
        renderAgentEntityIcon(
          sidebarIconType(ctx.agentIconType),
          agent,
          ctx.defaultModelId,
          ENTITY_ICON_PIXEL_SIZE[iconSize]
        ),
      isOpen: (state) =>
        state.tabs?.some((tab) => isTabForConversationEntry(tab, { type: 'agent', entityId: agent.id })) ?? false,
      isCurrent: (state) => isTabForConversationEntry(state.currentTab, { type: 'agent', entityId: agent.id }),
      onOpen: () => ctx.openAgent(agent.id),
      onOpenNewTab: () => ctx.openAgent(agent.id, { inNewTab: true }),
      contextMenuItems: [
        {
          type: 'item',
          id: `sidebar.remove-agent.${agent.id}`,
          label: ctx.t('launchpad.unpin_from_sidebar'),
          onSelect: () => ctx.removeAgent(agent.id)
        }
      ]
    }
  }
}

const assistantVariant: SidebarVariantDescriptor<Extract<SidebarFavoriteItem, { type: 'assistant' }>> = {
  resolve: (item, ctx) => {
    const assistant = ctx.installedAssistants.get(item.id)
    // Stale assistant (deleted) is dropped from the list but stays in the preference.
    if (!assistant) return null

    return {
      key: getSidebarFavoriteKey(item),
      label: assistant.name,
      // Same renderer the assistant rail uses, so a pinned row matches the list it came from.
      // 'none' would leave the row with no glyph at all, so the sidebar keeps the emoji there.
      renderIcon: (_size, iconSize) =>
        renderAssistantEntityIcon(
          sidebarIconType(ctx.assistantIconType),
          assistant,
          ctx.defaultModelId,
          ENTITY_ICON_PIXEL_SIZE[iconSize]
        ),
      isOpen: (state) =>
        state.tabs?.some((tab) => isTabForConversationEntry(tab, { type: 'assistant', entityId: assistant.id })) ??
        false,
      isCurrent: (state) => isTabForConversationEntry(state.currentTab, { type: 'assistant', entityId: assistant.id }),
      onOpen: () => ctx.openAssistant(assistant.id),
      onOpenNewTab: () => ctx.openAssistant(assistant.id, { inNewTab: true }),
      contextMenuItems: [
        {
          type: 'item',
          id: `sidebar.remove-assistant.${assistant.id}`,
          label: ctx.t('launchpad.unpin_from_sidebar'),
          onSelect: () => ctx.removeAssistant(assistant.id)
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
    case 'agent':
      return agentVariant.resolve(favorite, ctx)
    case 'assistant':
      return assistantVariant.resolve(favorite, ctx)
    default:
      return assertNever(favorite)
  }
}
