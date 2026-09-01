import { renderAgentEntityIcon, renderAssistantEntityIcon } from '@renderer/components/chat/resourceList/base'
import { CLI_TOOLS, CliIcon } from '@renderer/components/icons/CliIcon'
import MiniAppIcon from '@renderer/components/icons/MiniAppIcon'
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
import { FileEntryIdSchema } from '@shared/data/types/file'
import { CodeCli } from '@shared/types/codeCli'
import { BotMessageSquare, Database, FileText, MessagesSquare, Package } from 'lucide-react'

import { SIDEBAR_ICON_COMPONENTS } from '../sidebarIcons'
import type { ResolvedShortcut, SidebarShortcutProvider } from './types'

const REVEAL_ACTIVATIONS = new Set<string | undefined>([undefined, 'reveal'])
const CODE_CLI_TOOL_BY_ID = new Map<string, (typeof CLI_TOOLS)[number]>(CLI_TOOLS.map((tool) => [tool.value, tool]))

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

async function resolvePaginatedTargets<T>(
  targets: readonly SidebarShortcutTarget[],
  maxBatchSize: number,
  fetchBatch: (ids: string[]) => Promise<{ items: T[] }>,
  idOf: (entity: T) => string,
  resolve: (entity: T) => ResolvedShortcut
): Promise<Map<string, ResolvedShortcut>> {
  const ids = [...new Set(targets.map((target) => target.locator.resourceId))]
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += maxBatchSize) {
    batches.push(ids.slice(index, index + maxBatchSize))
  }
  const pages = await Promise.all(batches.map(fetchBatch))
  return mapRequested(
    targets,
    pages.flatMap((page) => page.items),
    idOf,
    resolve
  )
}

function isActiveResourceUrl(url: string, pathname: string, param: string, resourceId: string): boolean {
  const parsed = new URL(url, 'app://cherry')
  return parsed.pathname === pathname && parsed.searchParams.get(param) === resourceId
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

function localizedCollectionSubscription(
  endpoint: Parameters<typeof dataApiService.onDataChanged>[0]
): NonNullable<SidebarShortcutProvider['subscribe']> {
  return (_targets, invalidate) => {
    const unsubscribeData = dataApiService.onDataChanged(endpoint, invalidate)
    const unsubscribeLanguage = languageSubscription(invalidate)
    return () => {
      unsubscribeData()
      unsubscribeLanguage()
    }
  }
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
        renderIcon: ({ glyphSize }) => <Icon size={glyphSize} strokeWidth={1.6} />,
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
        renderIcon: ({ slotSize, glyphSize }) =>
          app.logo || app.logoSrc ? (
            <MiniAppIcon app={app} appearance="bare" size={slotSize} artworkSize={glyphSize - 2} />
          ) : (
            <Package size={glyphSize} strokeWidth={1.6} />
          ),
        tabIcon: app.logoSrc ?? app.logo,
        supportsNewTab: true
      })
    )
  },
  subscribe: localizedCollectionSubscription('/mini-apps'),
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
        renderIcon: ({ slotSize }) =>
          renderAgentEntityIcon(iconType === 'none' ? 'emoji' : iconType, agent, defaultModelId, slotSize),
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
        renderIcon: ({ slotSize, glyphSize }) =>
          renderAssistantEntityIcon(
            iconType === 'none' ? 'emoji' : iconType,
            assistant,
            defaultModelId,
            slotSize,
            glyphSize
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

const knowledgeBaseProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.KNOWLEDGE_BASE,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.KNOWLEDGE_BASE, target),
  resolveMany: (targets) =>
    resolvePaginatedTargets(
      targets,
      100,
      (ids) => dataApiService.get('/knowledge-bases', { query: { ids, limit: ids.length } }),
      (base) => base.id,
      (base) => ({
        label: base.name,
        renderIcon: ({ glyphSize }) => <Database size={glyphSize} strokeWidth={1.6} />,
        supportsNewTab: true
      })
    ),
  subscribe: collectionSubscription('/knowledge-bases'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openWorkspace({
      url: `/app/knowledge?baseId=${encodeURIComponent(target.locator.resourceId)}`,
      title: target.locator.resourceId
    })
  },
  isActive: (target, navigation) =>
    isActiveResourceUrl(navigation.url, '/app/knowledge', 'baseId', target.locator.resourceId)
}

const topicProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.TOPIC,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.TOPIC, target),
  resolveMany: (targets) =>
    resolvePaginatedTargets(
      targets,
      200,
      (ids) => dataApiService.get('/topics', { query: { ids, limit: ids.length } }),
      (topic) => topic.id,
      (topic) => ({
        label: topic.name.trim() || i18n.t('chat.conversation.new'),
        renderIcon: ({ glyphSize }) => <MessagesSquare size={glyphSize} strokeWidth={1.6} />,
        supportsNewTab: true
      })
    ),
  subscribe: localizedCollectionSubscription('/topics'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openWorkspace({
      url: `/app/chat?topicId=${encodeURIComponent(target.locator.resourceId)}`,
      title: target.locator.resourceId
    })
  },
  isActive: (target, navigation) =>
    !isMessageOnlyConversationUrl(navigation.url) &&
    isActiveResourceUrl(navigation.url, '/app/chat', 'topicId', target.locator.resourceId)
}

const agentSessionProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT_SESSION,
  validate: (target) => validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT_SESSION, target),
  resolveMany: (targets) =>
    resolvePaginatedTargets(
      targets,
      200,
      (ids) => dataApiService.get('/agent-sessions', { query: { ids, limit: ids.length } }),
      (session) => session.id,
      (session) => ({
        label: session.name.trim() || i18n.t('agent.session.new'),
        renderIcon: ({ glyphSize }) => <BotMessageSquare size={glyphSize} strokeWidth={1.6} />,
        supportsNewTab: true
      })
    ),
  subscribe: localizedCollectionSubscription('/agent-sessions'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openWorkspace({
      url: `/app/agents?sessionId=${encodeURIComponent(target.locator.resourceId)}`,
      title: target.locator.resourceId
    })
  },
  isActive: (target, navigation) =>
    !isMessageOnlyConversationUrl(navigation.url) &&
    isActiveResourceUrl(navigation.url, '/app/agents', 'sessionId', target.locator.resourceId)
}

const fileEntryProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.FILE_ENTRY,
  validate: (target) =>
    validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.FILE_ENTRY, target) &&
    FileEntryIdSchema.safeParse(target.locator.resourceId).success,
  resolveMany: (targets) =>
    resolvePaginatedTargets(
      targets,
      100,
      (ids) => dataApiService.get('/files/entries', { query: { ids, limit: ids.length } }),
      (entry) => entry.id,
      (entry) => ({
        label: entry.ext ? `${entry.name}.${entry.ext}` : entry.name,
        renderIcon: ({ glyphSize }) => <FileText size={glyphSize} strokeWidth={1.6} />,
        supportsNewTab: true
      })
    ),
  subscribe: collectionSubscription('/files/entries'),
  activate(target, gateway) {
    if (!this.validate(target)) return
    gateway.openWorkspace({
      url: `/app/files?entryId=${encodeURIComponent(target.locator.resourceId)}`,
      title: target.locator.resourceId
    })
  },
  isActive: (target, navigation) =>
    isActiveResourceUrl(navigation.url, '/app/files', 'entryId', target.locator.resourceId)
}

const codeCliProvider: SidebarShortcutProvider = {
  id: SIDEBAR_SHORTCUT_PROVIDER_IDS.CODE_CLI,
  validate: (target) =>
    validates(SIDEBAR_SHORTCUT_PROVIDER_IDS.CODE_CLI, target) && CODE_CLI_TOOL_BY_ID.has(target.locator.resourceId),
  async resolveMany(targets) {
    return mapRequested(
      targets,
      CLI_TOOLS,
      (tool) => tool.value,
      (tool) => ({
        label: i18n.t(tool.label),
        renderIcon: ({ slotSize, glyphSize }) => (
          <CliIcon id={tool.value} size={tool.value === CodeCli.PI ? glyphSize : slotSize} />
        ),
        supportsNewTab: true
      })
    )
  },
  subscribe: (_targets, invalidate) => languageSubscription(invalidate),
  activate(target, gateway) {
    if (!this.validate(target)) return
    const tool = CODE_CLI_TOOL_BY_ID.get(target.locator.resourceId)
    if (!tool) return
    gateway.openWorkspace({
      url: `/app/code?tool=${encodeURIComponent(tool.value)}`,
      title: i18n.t(tool.label),
      matchesCurrent: (currentUrl) => isActiveResourceUrl(currentUrl, '/app/code', 'tool', tool.value)
    })
  },
  isActive: (target, navigation) => isActiveResourceUrl(navigation.url, '/app/code', 'tool', target.locator.resourceId)
}

export const CORE_SIDEBAR_SHORTCUT_PROVIDERS: readonly SidebarShortcutProvider[] = [
  appProvider,
  miniAppProvider,
  agentProvider,
  assistantProvider,
  knowledgeBaseProvider,
  topicProvider,
  agentSessionProvider,
  fileEntryProvider,
  codeCliProvider
]
