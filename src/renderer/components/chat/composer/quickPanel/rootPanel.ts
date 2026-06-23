import type {
  QuickPanelContextType,
  QuickPanelInputAdapter,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelTriggerInfo
} from '@renderer/components/chat/composer/panelEngine'

import type { ComposerToolLauncher } from '../toolLauncher'
import { ComposerPanelSymbol } from './symbols'

export type ComposerRootPanelSelectHandler = (
  launcher: ComposerToolLauncher,
  options: {
    source: 'root-panel'
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

function createRootPanelActionOptions(options: {
  inputAdapter?: QuickPanelInputAdapter
  quickPanel: QuickPanelContextType
  onToolLauncherSelect?: ComposerRootPanelSelectHandler
  parentPanel?: QuickPanelOpenOptions
  queryAnchor?: number
  searchText?: string
  triggerInfo?: QuickPanelTriggerInfo
}) {
  return {
    source: 'root-panel' as const,
    inputAdapter: options.inputAdapter,
    quickPanel: createQuickPanelWithParent(options.quickPanel, options.parentPanel),
    triggerInfo: options.triggerInfo ?? options.quickPanel.triggerInfo ?? { type: 'button' as const },
    parentPanel: options.parentPanel,
    queryAnchor: options.queryAnchor,
    searchText: options.searchText
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

function launcherSupportsSource(launcher: ComposerToolLauncher, source: 'root-panel') {
  return !launcher.sources || launcher.sources.includes(source)
}

function getRootPanelChildren(launcher: ComposerToolLauncher) {
  return (launcher.submenu ?? []).filter((item) => !item.hidden && launcherSupportsSource(item, 'root-panel'))
}

function getLauncherTreeSearchText(launcher: ComposerToolLauncher): string {
  const childText = getRootPanelChildren(launcher).map(getLauncherTreeSearchText)
  return [getLauncherSearchText(launcher), ...childText].filter(Boolean).join(' ')
}

function createRootPanelListItem(
  launcher: ComposerToolLauncher,
  options: {
    inputAdapter?: QuickPanelInputAdapter
    quickPanel: QuickPanelContextType
    onToolLauncherSelect?: ComposerRootPanelSelectHandler
    getRootPanelOptions?: () => QuickPanelOpenOptions
  }
): QuickPanelListItem {
  const rootChildren = getRootPanelChildren(launcher)

  return {
    label: launcher.label,
    description: getLauncherDescription(launcher),
    icon: launcher.icon,
    suffix: launcher.suffix,
    isSelected: launcher.active,
    isMenu: launcher.kind === 'panel' || launcher.kind === 'group' || rootChildren.length > 0,
    disabled: launcher.disabled,
    filterText: getLauncherTreeSearchText(launcher),
    action: ({ context, parentPanel: actionParentPanel, queryAnchor, searchText }) => {
      const parentPanel = actionParentPanel ?? options.getRootPanelOptions?.()
      const triggerInfo = context.triggerInfo ?? options.quickPanel.triggerInfo

      if (rootChildren.length > 0) {
        openRootPanelSubmenu(launcher, { ...options, parentPanel, queryAnchor, searchText, triggerInfo })
        return
      }

      options.onToolLauncherSelect?.(
        launcher,
        createRootPanelActionOptions({
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

function openRootPanelSubmenu(
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
  const childItems = getRootPanelChildren(launcher).map((child) => createRootPanelListItem(child, options))

  options.quickPanel.open({
    title: typeof launcher.label === 'string' ? launcher.label : undefined,
    list: childItems,
    symbol: launcher.id,
    parentPanel: options.parentPanel,
    queryAnchor: options.queryAnchor,
    triggerInfo: options.triggerInfo ?? { type: 'button' }
  })
}

export function createRootQuickPanelOpenOptions(
  launchers: readonly ComposerToolLauncher[],
  options: {
    inputAdapter?: QuickPanelInputAdapter
    quickPanel: QuickPanelContextType
    onToolLauncherSelect?: ComposerRootPanelSelectHandler
    title?: string
    additionalItems?: readonly QuickPanelListItem[]
    queryAnchor?: number
    triggerInfo?: QuickPanelTriggerInfo
  }
): QuickPanelOpenOptions {
  const getRootPanelOptions = () =>
    createRootQuickPanelOpenOptions(launchers, {
      ...options
    })

  return {
    title: options.title,
    list: [
      ...launchers
        .filter((launcher) => !launcher.hidden)
        .flatMap((launcher) => {
          const rootChildren = getRootPanelChildren(launcher)
          const supportsRootPanel = launcherSupportsSource(launcher, 'root-panel')

          if (!supportsRootPanel && rootChildren.length === 0) return []

          return [
            createRootPanelListItem(
              { ...launcher, submenu: rootChildren },
              {
                ...options,
                getRootPanelOptions
              }
            )
          ]
        }),
      ...(options.additionalItems ?? [])
    ],
    symbol: ComposerPanelSymbol.Root,
    queryAnchor: options.queryAnchor,
    triggerInfo: options.triggerInfo ?? { type: 'button' },
    trackInputQuery: options.triggerInfo?.type === 'input'
  }
}
