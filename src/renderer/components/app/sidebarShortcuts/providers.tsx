import { renderAgentEntityIcon, renderAssistantEntityIcon } from '@renderer/components/chat/resourceList/base'
import MiniAppIcon from '@renderer/components/icons/MiniAppIcon'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { dataApiService } from '@renderer/data/DataApiService'
import { preferenceService } from '@renderer/data/PreferenceService'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import i18n from '@renderer/i18n/resolver'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'
import {
  getSidebarApp,
  getSidebarMenuPath,
  isMessageOnlyConversationUrl,
  isSidebarAppId,
  SIDEBAR_SHORTCUT_PROVIDER_IDS,
  tabBelongsToApp
} from '@renderer/utils/sidebar'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import { Server, Sparkles } from 'lucide-react'

import { SIDEBAR_ICON_COMPONENTS } from '../sidebarIcons'
import type { ResolvedShortcut, SidebarShortcutProvider } from './types'

const REVEAL_ACTIVATIONS = new Set<string | undefined>([undefined, 'reveal'])
const ENTITY_ICON_SIZE = { md: 18, lg: 24 } as const

function validates(providerId: string, target: SidebarShortcutTarget): boolean {
  return (
    target.kind === 'resource' &&
    target.locator.providerId === providerId &&
    target.locator.resourceId.length > 0 &&
    REVEAL_ACTIVATIONS.has(target.activationId)
  )
}

function mapRequested<T>(
  targets: readonly SidebarShortcutTarget[],
  entities: readonly T[],
  idOf: (entity: T) => string,
  resolve: (entity: T) => ResolvedShortcut
): Map<string, ResolvedShortcut> {
  const targetsByResourceId = new Map<string, SidebarShortcutTarget[]>()
  for (const target of targets) {
    const matches = targetsByResourceId.get(target.locator.resourceId) ?? []
    matches.push(target)
    targetsByResourceId.set(target.locator.resourceId, matches)
  }
  const result = new Map<string, ResolvedShortcut>()
  for (const entity of entities) {
    const matches = targetsByResourceId.get(idOf(entity))
    if (!matches) continue
    const resource = resolve(entity)
    for (const target of matches) result.set(createSidebarShortcutId(target), resource)
  }
  return result
}

function collectionSubscription(
  endpoint: Parameters<typeof dataApiService.onDataChanged>[0]
): NonNullable<SidebarShortcutProvider['subscribe']> {
  return (_targets, invalidate) => dataApiService.onDataChanged(endpoint, invalidate)
}

function languageSubscription(invalidate: () => void): () => void {
  i18n.on('languageChanged', invalidate)
  return () => i18n.off('languageChanged', invalidate)
}

const appProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.APP,
  validate: (target) =>
    validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.APP, target) && isSidebarAppId(target.locator.resourceId),
  async resolveMany(targets) {
    const result = new Map<string, ResolvedShortcut>()
    for (const target of targets) {
      const id = target.locator.resourceId
      if (!isSidebarAppId(id) || !getSidebarApp(id)) continue
      const Icon = SIDEBAR_ICON_COMPONENTS[id]
      result.set(createSidebarShortcutId(target), {
        label: i18n.t(getSidebarIconLabelKey(id)),
        renderIcon: (size) => <Icon size={size} strokeWidth={1.6} />,
        supportsNewTab: true
      })
    }
    return result
  },
  async activate(target, gateway) {
    if (!this.validate(target)) return
    const defaultPaintingProvider = await preferenceService.get('feature.paintings.default_provider')
    const id = target.locator.resourceId
    if (!isSidebarAppId(id)) return
    const url = getSidebarMenuPath(id, defaultPaintingProvider)
    const app = getSidebarApp(id)
    if (!url || !app) return
    gateway.openWorkspace({
      url,
      title: i18n.t(getSidebarIconLabelKey(id)),
      matchesCurrent: (currentUrl) =>
        app.conversationRoute
          ? tabBelongsToApp(app, currentUrl) && !isMessageOnlyConversationUrl(currentUrl)
          : currentUrl === url
    })
  },
  subscribe: (_targets, invalidate) => languageSubscription(invalidate),
  isActive(target, navigation) {
    const app = isSidebarAppId(target.locator.resourceId) ? getSidebarApp(target.locator.resourceId) : undefined
    return !!app && (app.exactRouteFocus ? navigation.url === app.routePrefix : tabBelongsToApp(app, navigation.url))
  }
}

const miniAppProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.MINI_APP,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.MINI_APP, target),
  async resolveMany(targets) {
    const miniApps = await dataApiService.get('/mini-apps')
    return mapRequested(
      targets,
      miniApps,
      (app) => app.appId,
      (app) => ({
        label: app.nameKey ? i18n.t(app.nameKey) : app.name,
        renderIcon: (_size, miniAppSize) => (
          <MiniAppIcon app={app} appearance="bare" size={ENTITY_ICON_SIZE[miniAppSize]} />
        ),
        tabIcon: app.logoSrc ?? app.logo,
        supportsNewTab: true
      })
    )
  },
  subscribe: (_targets, invalidate) => {
    const unsubscribeData = collectionSubscription('/mini-apps')([], invalidate)
    const unsubscribeLanguage = languageSubscription(invalidate)
    return () => {
      unsubscribeData()
      unsubscribeLanguage()
    }
  },
  activate(target, gateway) {
    if (!this.validate(target)) return
    const id = target.locator.resourceId
    gateway.openWorkspace({ url: `/app/mini-app/${encodeURIComponent(id)}`, title: id })
  },
  isActive: (target, navigation) => miniAppIdFromTabUrl(navigation.url) === target.locator.resourceId
}

const agentProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT, target),
  async resolveMany(targets) {
    const [response, iconType, defaultModelId] = await Promise.all([
      dataApiService.get('/agents', { query: { limit: 500 } }),
      preferenceService.get('agent.icon_type'),
      preferenceService.get('chat.default_model_id')
    ])
    return mapRequested(
      targets,
      response.items,
      (agent) => agent.id,
      (agent) => ({
        label: agent.name,
        renderIcon: (_size, entitySize) =>
          renderAgentEntityIcon(
            iconType === 'none' ? 'emoji' : iconType,
            agent,
            defaultModelId,
            ENTITY_ICON_SIZE[entitySize]
          ),
        supportsNewTab: true
      })
    )
  },
  subscribe: collectionSubscription('/agents'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openWorkspace({
      url: `/app/agents?agentId=${encodeURIComponent(target.locator.resourceId)}`,
      title: target.locator.resourceId
    })
  }
}

const assistantProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.ASSISTANT,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.ASSISTANT, target),
  async resolveMany(targets) {
    const [response, iconType, defaultModelId] = await Promise.all([
      dataApiService.get('/assistants', { query: { limit: 500 } }),
      preferenceService.get('assistant.icon_type'),
      preferenceService.get('chat.default_model_id')
    ])
    return mapRequested(
      targets,
      response.items,
      (assistant) => assistant.id,
      (assistant) => ({
        label: assistant.name,
        renderIcon: (_size, entitySize) =>
          renderAssistantEntityIcon(
            iconType === 'none' ? 'emoji' : iconType,
            assistant,
            defaultModelId,
            ENTITY_ICON_SIZE[entitySize]
          ),
        supportsNewTab: true
      })
    )
  },
  subscribe: collectionSubscription('/assistants'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openWorkspace({
      url: `/app/chat?assistantId=${encodeURIComponent(target.locator.resourceId)}`,
      title: target.locator.resourceId
    })
  }
}

const skillProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.SKILL,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.SKILL, target),
  async resolveMany(targets) {
    const skills = await dataApiService.get('/skills')
    return mapRequested(
      targets,
      skills,
      (skill) => skill.id,
      (skill) => ({
        label: skill.name,
        renderIcon: (size) => <Sparkles size={size} strokeWidth={1.6} />
      })
    )
  },
  subscribe: collectionSubscription('/skills'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openSettings(`/settings/skills?id=${encodeURIComponent(target.locator.resourceId)}`)
  },
  isActive: (target, navigation) => {
    const url = new URL(navigation.url, 'app://cherry')
    return url.pathname === '/settings/skills' && url.searchParams.get('id') === target.locator.resourceId
  }
}

const mcpServerProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.MCP_SERVER,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.MCP_SERVER, target),
  async resolveMany(targets) {
    const response = await dataApiService.get('/mcp-servers')
    return mapRequested(
      targets,
      response.items,
      (server) => server.id,
      (server) => ({
        label: server.name,
        renderIcon: (size) => <Server size={size} strokeWidth={1.6} />
      })
    )
  },
  subscribe: collectionSubscription('/mcp-servers'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openSettings(`/settings/mcp/settings/${encodeURIComponent(target.locator.resourceId)}`)
  },
  isActive: (target, navigation) =>
    navigation.url.startsWith(`/settings/mcp/settings/${encodeURIComponent(target.locator.resourceId)}`)
}

const providerProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.PROVIDER,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.PROVIDER, target),
  async resolveMany(targets) {
    const providers = await dataApiService.get('/providers', { query: {} })
    return mapRequested(
      targets,
      providers,
      (provider) => provider.id,
      (provider) => ({
        label: provider.name,
        renderIcon: (_size, miniAppSize) => (
          <ProviderAvatarPrimitive
            providerId={provider.id}
            providerName={provider.name}
            logo={provider.logoSrc ?? provider.logo}
            size={ENTITY_ICON_SIZE[miniAppSize]}
          />
        )
      })
    )
  },
  subscribe: collectionSubscription('/providers'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openSettings(`/settings/provider?id=${encodeURIComponent(target.locator.resourceId)}`)
  },
  isActive: (target, navigation) => {
    const url = new URL(navigation.url, 'app://cherry')
    return url.pathname === '/settings/provider' && url.searchParams.get('id') === target.locator.resourceId
  }
}

export const CORE_SIDEBAR_SHORTCUT_PROVIDERS: readonly SidebarShortcutProvider[] = [
  appProvider,
  miniAppProvider,
  agentProvider,
  assistantProvider,
  skillProvider,
  mcpServerProvider,
  providerProvider
]
