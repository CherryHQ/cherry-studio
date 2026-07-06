import type {
  QuickPanelContextType,
  QuickPanelFilterFn,
  QuickPanelInputAdapter,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelSortFn,
  QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'
import * as tinyPinyin from 'tiny-pinyin'

import type { ComposerToolLauncher, ComposerToolLauncherSource } from '../toolLauncher'
import { ComposerPanelSymbol } from './symbols'

export type ComposerUnifiedPanelSection = 'primary-tools' | 'commands' | 'resources'

interface ComposerUnifiedPanelSortMetadata {
  section: ComposerUnifiedPanelSection
  order: number
}

const ComposerUnifiedPanelSortMetadataSymbol = Symbol('ComposerUnifiedPanelSortMetadata')

type ComposerUnifiedPanelSortedItem = QuickPanelListItem & {
  [ComposerUnifiedPanelSortMetadataSymbol]?: ComposerUnifiedPanelSortMetadata
}

export interface ComposerUnifiedPanelResourceContext {
  inputAdapter?: QuickPanelInputAdapter
  quickPanel: QuickPanelContextType
  triggerInfo?: QuickPanelTriggerInfo
  parentPanel?: QuickPanelOpenOptions
  queryAnchor?: number
  searchText?: string
}

export type ComposerUnifiedPanelResourceProvider = (
  query: string,
  context: ComposerUnifiedPanelResourceContext
) => Promise<QuickPanelListItem[]> | QuickPanelListItem[]

export interface ComposerUnifiedPanelControl {
  available: boolean
  open: () => void
}

export type ComposerUnifiedPanelSelectHandler = (
  launcher: ComposerToolLauncher,
  options: {
    source: ComposerToolLauncherSource
    inputAdapter?: QuickPanelInputAdapter
    quickPanel: QuickPanelContextType
    triggerInfo?: QuickPanelTriggerInfo
    parentPanel?: QuickPanelOpenOptions
    queryAnchor?: number
    searchText?: string
  }
) => void

function createQuickPanelWithParent(
  quickPanel: QuickPanelContextType,
  parentPanel?: QuickPanelOpenOptions
): QuickPanelContextType {
  if (!parentPanel) return quickPanel

  return {
    ...quickPanel,
    open: (options) => {
      quickPanel.open({
        ...options,
        parentPanel: options.parentPanel ?? parentPanel
      })
    }
  }
}

function getLauncherSearchText(launcher: ComposerToolLauncher) {
  return [launcher.label, launcher.description, launcher.tooltip, launcher.disabledReason, launcher.suffix]
    .map((value) => (typeof value === 'string' ? value : ''))
    .join(' ')
}

function getLauncherDescription(launcher: ComposerToolLauncher) {
  if (launcher.disabled && launcher.disabledReason) {
    return launcher.disabledReason
  }
  return launcher.description
}

function getUnifiedPanelSortLayer(section?: ComposerUnifiedPanelSection) {
  return section === 'resources' ? 1 : 0
}

function withUnifiedPanelSortMetadata(
  item: QuickPanelListItem,
  metadata: ComposerUnifiedPanelSortMetadata
): QuickPanelListItem {
  return {
    ...item,
    [ComposerUnifiedPanelSortMetadataSymbol]: metadata
  } as ComposerUnifiedPanelSortedItem
}

function getUnifiedPanelSortMetadata(item: QuickPanelListItem) {
  return (item as ComposerUnifiedPanelSortedItem)[ComposerUnifiedPanelSortMetadataSymbol]
}

function tagUnifiedPanelSectionItems(
  items: readonly QuickPanelListItem[] | undefined,
  section: ComposerUnifiedPanelSection,
  nextOrder: { value: number }
) {
  return (items ?? []).map((item) =>
    withUnifiedPanelSortMetadata(item, {
      section,
      order: nextOrder.value++
    })
  )
}

const sortUnifiedQuickPanelItems: QuickPanelSortFn = (items, searchText) => {
  if (!searchText) return items

  return items
    .map((item, index) => ({
      item,
      index,
      metadata: getUnifiedPanelSortMetadata(item)
    }))
    .sort((a, b) => {
      const layerDiff = getUnifiedPanelSortLayer(a.metadata?.section) - getUnifiedPanelSortLayer(b.metadata?.section)
      if (layerDiff !== 0) return layerDiff

      const orderA = a.metadata?.order ?? a.index
      const orderB = b.metadata?.order ?? b.index
      if (orderA !== orderB) return orderA - orderB

      return a.index - b.index
    })
    .map(({ item }) => item)
}

function getUnifiedQuickPanelMatchText(item: QuickPanelListItem) {
  // `filterText`, when set, is the authoritative search field for the item
  // (e.g. skills set it to their name only). Otherwise fall back to the visible
  // label + description so items without an explicit search field stay searchable.
  if (item.filterText) return item.filterText

  const parts: string[] = []
  if (typeof item.label === 'string') parts.push(item.label)
  if (typeof item.description === 'string') parts.push(item.description)
  return parts.join(' ')
}

/**
 * Root panel filter: substring match, plus pinyin substring for Chinese text.
 * Intentionally avoids the default loose fuzzy subsequence matching so unrelated
 * rows (e.g. Quick Phrases) don't surface for a query typed for another item.
 */
const filterUnifiedQuickPanelItems: QuickPanelFilterFn = (item, searchText, _fuzzyRegex, pinyinCache) => {
  if (!searchText) return true

  const matchText = getUnifiedQuickPanelMatchText(item).toLowerCase()
  if (!matchText) return false

  const query = searchText.toLowerCase()
  if (matchText.includes(query)) return true

  if (tinyPinyin.isSupported() && /[\u4e00-\u9fa5]/.test(matchText)) {
    let pinyinText = pinyinCache.get(item)
    if (pinyinText === undefined) {
      pinyinText = tinyPinyin.convertToPinyin(matchText, '', true).toLowerCase()
      pinyinCache.set(item, pinyinText)
    }
    return pinyinText.includes(query)
  }

  return false
}

function launcherSupportsSource(launcher: ComposerToolLauncher, source: ComposerToolLauncherSource) {
  return !launcher.sources || launcher.sources.includes(source)
}

function getLauncherPreferredSource(launcher: ComposerToolLauncher): ComposerToolLauncherSource {
  return launcherSupportsSource(launcher, 'popover') ? 'popover' : 'root-panel'
}

function getUnifiedChildren(launcher: ComposerToolLauncher, seenLauncherIds?: ReadonlySet<string>) {
  return (launcher.submenu ?? []).filter(
    (item) =>
      !item.hidden &&
      !seenLauncherIds?.has(item.id) &&
      (launcherSupportsSource(item, 'popover') || launcherSupportsSource(item, 'root-panel'))
  )
}

function getSectionChildren(launcher: ComposerToolLauncher, source: ComposerToolLauncherSource) {
  return (launcher.submenu ?? []).filter((item) => !item.hidden && launcherSupportsSource(item, source))
}

function getLauncherTreeSearchText(launcher: ComposerToolLauncher, seenLauncherIds = new Set<string>()): string {
  if (seenLauncherIds.has(launcher.id)) return ''

  const nextSeenLauncherIds = new Set(seenLauncherIds)
  nextSeenLauncherIds.add(launcher.id)

  const childText = getUnifiedChildren(launcher, nextSeenLauncherIds).map((child) =>
    getLauncherTreeSearchText(child, nextSeenLauncherIds)
  )
  return [getLauncherSearchText(launcher), ...childText].filter(Boolean).join(' ')
}

function createUnifiedPanelActionOptions(options: {
  source: ComposerToolLauncherSource
  inputAdapter?: QuickPanelInputAdapter
  quickPanel: QuickPanelContextType
  parentPanel?: QuickPanelOpenOptions
  queryAnchor?: number
  searchText?: string
  triggerInfo?: QuickPanelTriggerInfo
}) {
  return {
    source: options.source,
    inputAdapter: options.inputAdapter,
    quickPanel: createQuickPanelWithParent(options.quickPanel, options.parentPanel),
    triggerInfo: options.triggerInfo ?? options.quickPanel.triggerInfo ?? { type: 'button' as const },
    parentPanel: options.parentPanel,
    queryAnchor: options.queryAnchor,
    searchText: options.searchText
  }
}

function createUnifiedPanelListItem(
  launcher: ComposerToolLauncher,
  options: {
    source: ComposerToolLauncherSource
    inputAdapter?: QuickPanelInputAdapter
    quickPanel: QuickPanelContextType
    onToolLauncherSelect?: ComposerUnifiedPanelSelectHandler
    getRootPanelOptions?: () => QuickPanelOpenOptions
    ancestorLauncherIds?: ReadonlySet<string>
  }
): QuickPanelListItem {
  const nextAncestorLauncherIds = new Set(options.ancestorLauncherIds)
  nextAncestorLauncherIds.add(launcher.id)
  const children = getUnifiedChildren(launcher, nextAncestorLauncherIds)

  return {
    label: launcher.label,
    description: getLauncherDescription(launcher),
    icon: launcher.icon,
    suffix: launcher.suffix,
    isSelected: launcher.active,
    isMenu: launcher.kind === 'panel' || launcher.kind === 'group' || children.length > 0,
    disabled: launcher.disabled,
    filterText: getLauncherTreeSearchText(launcher, new Set(options.ancestorLauncherIds)),
    action: ({ context, parentPanel: actionParentPanel, queryAnchor, searchText }) => {
      const parentPanel = actionParentPanel ?? options.getRootPanelOptions?.()
      const triggerInfo = context.triggerInfo ?? options.quickPanel.triggerInfo

      if (children.length > 0) {
        openUnifiedPanelSubmenu(launcher, {
          ...options,
          ancestorLauncherIds: nextAncestorLauncherIds,
          parentPanel,
          queryAnchor,
          searchText,
          triggerInfo
        })
        return
      }

      options.onToolLauncherSelect?.(
        launcher,
        createUnifiedPanelActionOptions({
          ...options,
          parentPanel,
          queryAnchor,
          searchText,
          triggerInfo
        })
      )
    }
  }
}

function openUnifiedPanelSubmenu(
  launcher: ComposerToolLauncher,
  options: {
    inputAdapter?: QuickPanelInputAdapter
    quickPanel: QuickPanelContextType
    onToolLauncherSelect?: ComposerUnifiedPanelSelectHandler
    getRootPanelOptions?: () => QuickPanelOpenOptions
    parentPanel?: QuickPanelOpenOptions
    queryAnchor?: number
    searchText?: string
    triggerInfo?: QuickPanelTriggerInfo
    ancestorLauncherIds?: ReadonlySet<string>
  }
) {
  const nextAncestorLauncherIds = new Set(options.ancestorLauncherIds)
  nextAncestorLauncherIds.add(launcher.id)
  const childItems = getUnifiedChildren(launcher, nextAncestorLauncherIds).map((child) =>
    createUnifiedPanelListItem(child, {
      ...options,
      ancestorLauncherIds: nextAncestorLauncherIds,
      source: getLauncherPreferredSource(child)
    })
  )

  options.quickPanel.open({
    title: typeof launcher.label === 'string' ? launcher.label : undefined,
    list: childItems,
    symbol: launcher.id,
    parentPanel: options.parentPanel,
    queryAnchor: options.queryAnchor,
    triggerInfo: options.triggerInfo ?? { type: 'button' }
  })
}

function createUnifiedSectionItems(
  launchers: readonly ComposerToolLauncher[],
  options: {
    source: ComposerToolLauncherSource
    seenLauncherIds: Set<string>
    inputAdapter?: QuickPanelInputAdapter
    quickPanel: QuickPanelContextType
    onToolLauncherSelect?: ComposerUnifiedPanelSelectHandler
    getRootPanelOptions?: () => QuickPanelOpenOptions
  }
) {
  return launchers.flatMap((launcher) => {
    if (launcher.hidden || options.seenLauncherIds.has(launcher.id)) return []

    const children = getSectionChildren(launcher, options.source)
    const supportsSource = launcherSupportsSource(launcher, options.source)

    if (!supportsSource && children.length === 0) return []

    options.seenLauncherIds.add(launcher.id)
    return [
      createUnifiedPanelListItem(
        { ...launcher, submenu: getUnifiedChildren(launcher) },
        {
          ...options,
          ancestorLauncherIds: new Set(),
          source: options.source
        }
      )
    ]
  })
}

function hasUnifiedSectionItems(
  launchers: readonly ComposerToolLauncher[],
  source: ComposerToolLauncherSource,
  seenLauncherIds: Set<string>
) {
  return launchers.some((launcher) => {
    if (launcher.hidden || seenLauncherIds.has(launcher.id)) return false

    const children = getSectionChildren(launcher, source)
    const supportsSource = launcherSupportsSource(launcher, source)

    if (!supportsSource && children.length === 0) return false

    seenLauncherIds.add(launcher.id)
    return true
  })
}

export function hasUnifiedQuickPanelRootContent(
  launchers: readonly ComposerToolLauncher[],
  options: {
    leadingItems?: readonly QuickPanelListItem[]
    additionalItems?: readonly QuickPanelListItem[]
    resourceItems?: readonly QuickPanelListItem[]
  } = {}
) {
  if ((options.leadingItems?.length ?? 0) > 0) return true
  if ((options.additionalItems?.length ?? 0) > 0) return true
  if ((options.resourceItems?.length ?? 0) > 0) return true

  const seenLauncherIds = new Set<string>()
  return (
    hasUnifiedSectionItems(launchers, 'popover', seenLauncherIds) ||
    hasUnifiedSectionItems(launchers, 'root-panel', seenLauncherIds)
  )
}

export function createUnifiedQuickPanelOpenOptions(
  launchers: readonly ComposerToolLauncher[],
  options: {
    inputAdapter?: QuickPanelInputAdapter
    quickPanel: QuickPanelContextType
    onToolLauncherSelect?: ComposerUnifiedPanelSelectHandler
    title?: string
    leadingItems?: readonly QuickPanelListItem[]
    additionalItems?: readonly QuickPanelListItem[]
    resourceItems?: readonly QuickPanelListItem[]
    queryAnchor?: number
    triggerInfo?: QuickPanelTriggerInfo
  }
): QuickPanelOpenOptions {
  const getRootPanelOptions = () =>
    createUnifiedQuickPanelOpenOptions(launchers, {
      ...options
    })
  const seenLauncherIds = new Set<string>()

  const primaryItems = createUnifiedSectionItems(launchers, {
    ...options,
    source: 'popover',
    seenLauncherIds,
    getRootPanelOptions
  })
  // Trailing launchers (e.g. slash commands) render after caller additional items
  // (e.g. agent skills); the rest of the root-panel command items stay above them.
  const commandItems = createUnifiedSectionItems(
    launchers.filter((launcher) => launcher.rootPanelPlacement !== 'trailing'),
    {
      ...options,
      source: 'root-panel',
      seenLauncherIds,
      getRootPanelOptions
    }
  )
  const trailingCommandItems = createUnifiedSectionItems(
    launchers.filter((launcher) => launcher.rootPanelPlacement === 'trailing'),
    {
      ...options,
      source: 'root-panel',
      seenLauncherIds,
      getRootPanelOptions
    }
  )
  const nextSortOrder = { value: 0 }
  const list = [
    ...tagUnifiedPanelSectionItems(options.leadingItems, 'primary-tools', nextSortOrder),
    ...tagUnifiedPanelSectionItems(primaryItems, 'primary-tools', nextSortOrder),
    ...tagUnifiedPanelSectionItems(commandItems, 'commands', nextSortOrder),
    ...tagUnifiedPanelSectionItems(options.additionalItems, 'commands', nextSortOrder),
    ...tagUnifiedPanelSectionItems(trailingCommandItems, 'commands', nextSortOrder),
    ...tagUnifiedPanelSectionItems(options.resourceItems, 'resources', nextSortOrder)
  ]

  return {
    title: options.title,
    list,
    symbol: ComposerPanelSymbol.Root,
    queryAnchor: options.queryAnchor,
    triggerInfo: options.triggerInfo ?? { type: 'button' },
    trackInputQuery: true,
    filterFn: filterUnifiedQuickPanelItems,
    sortFn: sortUnifiedQuickPanelItems
  }
}
