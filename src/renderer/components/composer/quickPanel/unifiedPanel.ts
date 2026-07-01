import type {
  QuickPanelContextType,
  QuickPanelInputAdapter,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'

import type { ComposerToolLauncher, ComposerToolLauncherSource } from '../toolLauncher'
import type { ComposerRootPanelSelectHandler } from './rootPanel'
import { ComposerPanelSymbol } from './symbols'

export type ComposerUnifiedPanelSection = 'primary-tools' | 'commands' | 'resources'

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

function launcherSupportsSource(launcher: ComposerToolLauncher, source: ComposerToolLauncherSource) {
  return !launcher.sources || launcher.sources.includes(source)
}

function getLauncherPreferredSource(launcher: ComposerToolLauncher): ComposerToolLauncherSource {
  return launcherSupportsSource(launcher, 'popover') ? 'popover' : 'root-panel'
}

function getUnifiedChildren(launcher: ComposerToolLauncher) {
  return (launcher.submenu ?? []).filter(
    (item) => !item.hidden && (launcherSupportsSource(item, 'popover') || launcherSupportsSource(item, 'root-panel'))
  )
}

function getSectionChildren(launcher: ComposerToolLauncher, source: ComposerToolLauncherSource) {
  return (launcher.submenu ?? []).filter((item) => !item.hidden && launcherSupportsSource(item, source))
}

function getLauncherTreeSearchText(launcher: ComposerToolLauncher): string {
  const childText = getUnifiedChildren(launcher).map(getLauncherTreeSearchText)
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
    onToolLauncherSelect?: ComposerRootPanelSelectHandler
    getRootPanelOptions?: () => QuickPanelOpenOptions
  }
): QuickPanelListItem {
  const children = getUnifiedChildren(launcher)

  return {
    label: launcher.label,
    description: getLauncherDescription(launcher),
    icon: launcher.icon,
    suffix: launcher.suffix,
    isSelected: launcher.active,
    isMenu: launcher.kind === 'panel' || launcher.kind === 'group' || children.length > 0,
    disabled: launcher.disabled,
    filterText: getLauncherTreeSearchText(launcher),
    action: ({ context, parentPanel: actionParentPanel, queryAnchor, searchText }) => {
      const parentPanel = actionParentPanel ?? options.getRootPanelOptions?.()
      const triggerInfo = context.triggerInfo ?? options.quickPanel.triggerInfo

      if (children.length > 0) {
        openUnifiedPanelSubmenu(launcher, { ...options, parentPanel, queryAnchor, searchText, triggerInfo })
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
    onToolLauncherSelect?: ComposerRootPanelSelectHandler
    getRootPanelOptions?: () => QuickPanelOpenOptions
    parentPanel?: QuickPanelOpenOptions
    queryAnchor?: number
    searchText?: string
    triggerInfo?: QuickPanelTriggerInfo
  }
) {
  const childItems = getUnifiedChildren(launcher).map((child) =>
    createUnifiedPanelListItem(child, {
      ...options,
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
    onToolLauncherSelect?: ComposerRootPanelSelectHandler
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
          source: options.source
        }
      )
    ]
  })
}

export function createUnifiedQuickPanelOpenOptions(
  launchers: readonly ComposerToolLauncher[],
  options: {
    inputAdapter?: QuickPanelInputAdapter
    quickPanel: QuickPanelContextType
    onToolLauncherSelect?: ComposerRootPanelSelectHandler
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
  const commandItems = createUnifiedSectionItems(launchers, {
    ...options,
    source: 'root-panel',
    seenLauncherIds,
    getRootPanelOptions
  })

  return {
    title: options.title,
    list: [
      ...(options.leadingItems ?? []),
      ...primaryItems,
      ...commandItems,
      ...(options.additionalItems ?? []),
      ...(options.resourceItems ?? [])
    ],
    symbol: ComposerPanelSymbol.Root,
    queryAnchor: options.queryAnchor,
    triggerInfo: options.triggerInfo ?? { type: 'button' },
    trackInputQuery: true
  }
}
