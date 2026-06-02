import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isMac, platform } from '@renderer/config/constant'
import {
  type CommandId,
  evaluateContextExpr,
  findCommandDefinition,
  findKeybindingRule,
  getCommandShortcutLabel,
  type MenuLocation,
  menuRegistry,
  type NativePopupMenuItem,
  type NativePopupMenuModel,
  REGISTERED_KEYBINDINGS,
  resolveCommandKeybinding,
  type ResolvedMenuItem,
  type ResolvedMenuModel,
  resolveMenuPresentationMode,
  type SupportedPlatform
} from '@shared/commands'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCommandRuntime } from './CommandProvider'
import { useCommandContextReader } from './ContextKeyProvider'

type CommandIconRenderer = (iconKey: string | undefined) => React.ReactNode

const logger = loggerService.withContext('CommandMenus')

export type MaybePromise<T> = T | PromiseLike<T>

export type CommandContextMenuExtraItem =
  | { type: 'separator' }
  | {
      type: 'submenu'
      id: string
      label: string
      enabled?: boolean
      icon?: React.ReactNode
      children: readonly CommandContextMenuExtraItem[]
    }
  | {
      type: 'item'
      id: string
      label: string
      enabled?: boolean
      destructive?: boolean
      checked?: boolean
      /** Prefer this for command-backed items; the menu resolves platform and user preference. */
      shortcutCommand?: CommandId
      /** Escape hatch for non-command shortcuts only. */
      shortcutLabel?: string
      accelerator?: string
      icon?: React.ReactNode
      badge?: React.ReactNode
      onSelect: () => void
    }

type CommandContextMenuItem = ResolvedMenuItem<CommandId> | CommandContextMenuExtraItem
type ExtraRenderableMenuItem = Extract<CommandContextMenuExtraItem, { type: 'item' | 'submenu' }>
type CommandContextMenuExtraItemsResolver = (
  event: React.MouseEvent
) => MaybePromise<readonly CommandContextMenuExtraItem[]>

const EMPTY_EXTRA_ITEMS: readonly CommandContextMenuExtraItem[] = []

const isExtraMenuItem = (item: CommandContextMenuItem): item is ExtraRenderableMenuItem =>
  item.type === 'item' || (item.type === 'submenu' && 'id' in item)

const shortcutPreferenceKeys = Object.fromEntries(
  REGISTERED_KEYBINDINGS.map((rule) => [rule.command, rule.preferenceKey])
) as Record<string, NonNullable<ReturnType<typeof findKeybindingRule>>['preferenceKey']>

const removeEmptySeparators = <T extends { type: string }>(items: readonly T[]): readonly T[] => {
  const result: T[] = []

  for (const item of items) {
    if (item.type === 'separator') {
      if (result.length > 0 && result.at(-1)?.type !== 'separator') {
        result.push(item)
      }
      continue
    }

    result.push(item)
  }

  if (result.at(-1)?.type === 'separator') {
    result.pop()
  }

  return result
}

const hasNonSeparatorItems = (items: readonly { type: string }[]): boolean =>
  items.some((item) => item.type !== 'separator')

const toNativePopupMenuItem = (item: CommandContextMenuItem): NativePopupMenuItem<CommandId> => {
  if (item.type === 'item') {
    return {
      type: 'custom',
      id: item.id,
      label: item.label,
      enabled: item.enabled,
      checked: item.checked,
      shortcutLabel: item.shortcutLabel,
      accelerator: item.accelerator
    }
  }

  if (item.type === 'submenu' && 'id' in item) {
    return {
      type: 'submenu',
      label: item.label,
      enabled: item.enabled !== false,
      children: item.children.map(toNativePopupMenuItem)
    }
  }

  return item
}

const combineContextMenuItems = (
  commandItems: readonly ResolvedMenuItem<CommandId>[],
  extraItems: readonly CommandContextMenuExtraItem[]
): readonly CommandContextMenuItem[] => {
  const separator: readonly CommandContextMenuExtraItem[] =
    commandItems.length > 0 && hasNonSeparatorItems(extraItems) ? [{ type: 'separator' }] : EMPTY_EXTRA_ITEMS

  return removeEmptySeparators<CommandContextMenuItem>([...commandItems, ...separator, ...extraItems])
}

const getExtraItemActions = (extraItems: readonly CommandContextMenuExtraItem[]): Map<string, () => void> => {
  const actions = new Map<string, () => void>()
  for (const item of extraItems) {
    if (item.type === 'item') {
      actions.set(item.id, item.onSelect)
    } else if (item.type === 'submenu') {
      for (const [id, action] of getExtraItemActions(item.children)) {
        actions.set(id, action)
      }
    }
  }
  return actions
}

export function useResolvedCommandMenu(location: MenuLocation): ResolvedMenuModel<CommandId> {
  const { t } = useTranslation()
  const runtime = useCommandRuntime()
  const context = useCommandContextReader()
  const [shortcutPreferences] = useMultiplePreferences(shortcutPreferenceKeys)

  return useMemo(
    () =>
      menuRegistry.resolve({
        location,
        context,
        getCommandState: (command) => {
          const definition = findCommandDefinition(command)
          const rule = findKeybindingRule(command)
          const preference = rule ? (shortcutPreferences[command] as PreferenceShortcutType | undefined) : undefined
          const keybinding = resolveCommandKeybinding({
            command,
            preference,
            context,
            platform: platform as SupportedPlatform
          })

          return {
            label: definition ? t(definition.titleKey) : command,
            enabled: Boolean(
              definition && runtime.hasHandler(command) && evaluateContextExpr(definition.enablement, context)
            ),
            iconKey: definition?.iconKey,
            shortcutLabel: getCommandShortcutLabel(command, preference, {
              context,
              isMac,
              platform: platform as SupportedPlatform
            }),
            accelerator: keybinding?.accelerator
          }
        }
      }),
    [context, location, runtime, shortcutPreferences, t]
  )
}

function CommandMenuItemView({
  item,
  onExecute,
  renderIcon
}: {
  item: ResolvedMenuItem<CommandId>
  onExecute: (command: CommandId) => void
  renderIcon?: CommandIconRenderer
}): React.ReactNode {
  if (item.type === 'separator') {
    return <ContextMenuSeparator />
  }

  if (item.type === 'submenu') {
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!item.enabled}>
          <ContextMenuItemContent icon={renderIcon?.(item.iconKey)}>{item.label}</ContextMenuItemContent>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {item.children.map((child, index) => (
            <CommandMenuItemView
              key={`${child.type}-${index}`}
              item={child}
              onExecute={onExecute}
              renderIcon={renderIcon}
            />
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    )
  }

  const content = (
    <ContextMenuItemContent icon={renderIcon?.(item.iconKey)} shortcut={item.shortcutLabel || undefined}>
      {item.label}
    </ContextMenuItemContent>
  )

  if (item.checked !== undefined) {
    return (
      <ContextMenuCheckboxItem
        checked={item.checked}
        disabled={!item.enabled}
        onCheckedChange={() => onExecute(item.command)}>
        {content}
      </ContextMenuCheckboxItem>
    )
  }

  return (
    <ContextMenuItem
      disabled={!item.enabled}
      variant={item.destructive ? 'destructive' : 'default'}
      onSelect={() => onExecute(item.command)}>
      {content}
    </ContextMenuItem>
  )
}

function CommandContextMenuExtraItemView({ item }: { item: CommandContextMenuExtraItem }): React.ReactNode {
  if (item.type === 'separator') {
    return <ContextMenuSeparator />
  }

  if (item.type === 'submenu') {
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={item.enabled === false}>
          <ContextMenuItemContent icon={item.icon}>{item.label}</ContextMenuItemContent>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {item.children.map((child, index) => (
            <CommandContextMenuExtraItemView key={`${child.type}-${index}`} item={child} />
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    )
  }

  return (
    <ContextMenuItem
      disabled={item.enabled === false}
      variant={item.destructive ? 'destructive' : 'default'}
      onSelect={item.onSelect}>
      <ContextMenuItemContent icon={item.icon} badge={item.badge} shortcut={item.shortcutLabel || undefined}>
        {item.label}
      </ContextMenuItemContent>
    </ContextMenuItem>
  )
}

export function CommandMenuItems({
  location,
  renderIcon
}: {
  location: MenuLocation
  renderIcon?: CommandIconRenderer
}): React.ReactNode {
  const runtime = useCommandRuntime()
  const model = useResolvedCommandMenu(location)
  const items = removeEmptySeparators(model.items)

  if (!items.length) {
    return null
  }

  return (
    <>
      {items.map((item, index) => (
        <CommandMenuItemView
          key={`${item.type}-${index}`}
          item={item}
          onExecute={runtime.execute}
          renderIcon={renderIcon}
        />
      ))}
    </>
  )
}

export function CommandContextMenu({
  location,
  children,
  contentClassName,
  disabled,
  onOpenChange,
  renderIcon,
  extraItems = EMPTY_EXTRA_ITEMS,
  pendingExtraItems,
  getExtraItems
}: {
  location: MenuLocation
  children: React.ReactNode
  contentClassName?: string
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  renderIcon?: CommandIconRenderer
  extraItems?: readonly CommandContextMenuExtraItem[]
  pendingExtraItems?: readonly CommandContextMenuExtraItem[]
  getExtraItems?: CommandContextMenuExtraItemsResolver
}): React.ReactNode {
  const [preferredMode] = usePreference('menu.presentation_mode')
  const context = useCommandContextReader()
  const [shortcutPreferences] = useMultiplePreferences(shortcutPreferenceKeys)
  const [resolvedExtraItems, setResolvedExtraItems] = useState<readonly CommandContextMenuExtraItem[] | null>(null)
  const extraItemsRequestIdRef = useRef(0)
  const runtime = useCommandRuntime()
  const model = useResolvedCommandMenu(location)
  const mode = resolveMenuPresentationMode(location, preferredMode)
  const commandItems = useMemo(() => removeEmptySeparators(model.items), [model.items])
  const pendingItems = pendingExtraItems ?? extraItems
  const resolveShortcutLabel = useCallback(
    (command: CommandId) => {
      const rule = findKeybindingRule(command)
      const preference = rule ? (shortcutPreferences[command] as PreferenceShortcutType | undefined) : undefined

      return getCommandShortcutLabel(command, preference, {
        context,
        isMac,
        platform: platform as SupportedPlatform
      })
    },
    [context, shortcutPreferences]
  )
  const resolveExtraItemShortcutLabels = useCallback(
    (items: readonly CommandContextMenuExtraItem[]): readonly CommandContextMenuExtraItem[] => {
      const resolve = (source: readonly CommandContextMenuExtraItem[]): CommandContextMenuExtraItem[] =>
        source.map((item) => {
          if (item.type === 'submenu') {
            return {
              ...item,
              children: resolve(item.children)
            }
          }

          if (item.type !== 'item' || !item.shortcutCommand) {
            return item
          }

          return {
            ...item,
            shortcutLabel: item.shortcutLabel || resolveShortcutLabel(item.shortcutCommand) || undefined
          }
        })

      return resolve(items)
    },
    [resolveShortcutLabel]
  )
  const displayedExtraItems = useMemo(
    () => resolveExtraItemShortcutLabels(getExtraItems ? (resolvedExtraItems ?? pendingItems) : extraItems),
    [extraItems, getExtraItems, pendingItems, resolveExtraItemShortcutLabels, resolvedExtraItems]
  )
  const combinedItems = useMemo<readonly CommandContextMenuItem[]>(
    () => combineContextMenuItems(commandItems, displayedExtraItems),
    [commandItems, displayedExtraItems]
  )
  const hasLazyExtraItems = Boolean(getExtraItems)

  const resolveExtraItems = useCallback(
    (event: React.MouseEvent): MaybePromise<readonly CommandContextMenuExtraItem[]> => {
      if (getExtraItems) {
        return getExtraItems(event)
      }
      return extraItems
    },
    [extraItems, getExtraItems]
  )

  const handleCherryContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!getExtraItems) {
        return
      }

      const requestId = extraItemsRequestIdRef.current + 1
      extraItemsRequestIdRef.current = requestId
      setResolvedExtraItems(pendingItems)

      void Promise.resolve(getExtraItems(event))
        .then((items) => {
          if (extraItemsRequestIdRef.current === requestId) {
            setResolvedExtraItems(items)
          }
        })
        .catch((error) => {
          logger.warn('Failed to resolve command menu extra items', error as Error)
          if (extraItemsRequestIdRef.current === requestId) {
            setResolvedExtraItems(EMPTY_EXTRA_ITEMS)
          }
        })
    },
    [getExtraItems, pendingItems]
  )

  const handleCherryOpenChange = useCallback(
    (open: boolean) => {
      onOpenChange?.(open)
      if (!open && getExtraItems) {
        extraItemsRequestIdRef.current += 1
        setResolvedExtraItems(null)
      }
    },
    [getExtraItems, onOpenChange]
  )

  const handleNativeContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (mode !== 'native') {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const anchor = {
        x: Math.round(event.clientX),
        y: Math.round(event.clientY)
      }
      const requestId = extraItemsRequestIdRef.current + 1
      extraItemsRequestIdRef.current = requestId

      let nativeExtraItems: MaybePromise<readonly CommandContextMenuExtraItem[]>
      try {
        nativeExtraItems = resolveExtraItems(event)
      } catch (error) {
        logger.warn('Failed to resolve command menu extra items', error as Error)
        nativeExtraItems = EMPTY_EXTRA_ITEMS
      }

      void Promise.resolve(nativeExtraItems)
        .catch((error) => {
          logger.warn('Failed to resolve command menu extra items', error as Error)
          return EMPTY_EXTRA_ITEMS
        })
        .then((resolvedNativeExtraItems) => {
          if (extraItemsRequestIdRef.current !== requestId) {
            return
          }

          const nativeExtraItems = resolveExtraItemShortcutLabels(resolvedNativeExtraItems)
          const nativeItems = combineContextMenuItems(commandItems, nativeExtraItems)
          const nativeModel: NativePopupMenuModel<CommandId> = {
            location,
            items: nativeItems.map(toNativePopupMenuItem)
          }

          if (!nativeModel.items.length) {
            return
          }

          return window.api.command.showNativePopupMenu(nativeModel, anchor).then((result) => {
            if (extraItemsRequestIdRef.current !== requestId) {
              return
            }

            if (result?.type === 'command') {
              runtime.execute(result.command)
              return
            }

            if (result?.type === 'custom') {
              getExtraItemActions(nativeExtraItems).get(result.id)?.()
            }
          })
        })
        .catch((error) => {
          logger.error('Failed to show native command menu', error as Error)
        })
    },
    [commandItems, location, mode, resolveExtraItemShortcutLabels, resolveExtraItems, runtime]
  )

  if (disabled || (!combinedItems.length && !hasLazyExtraItems)) {
    return <>{children}</>
  }

  if (mode === 'native') {
    return (
      <span className="contents" onContextMenu={handleNativeContextMenu}>
        {children}
      </span>
    )
  }

  return (
    <ContextMenu onOpenChange={handleCherryOpenChange}>
      <ContextMenuTrigger asChild onContextMenu={handleCherryContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className={contentClassName}>
        {combinedItems.map((item, index) =>
          isExtraMenuItem(item) ? (
            <CommandContextMenuExtraItemView key={`extra-${item.id}`} item={item} />
          ) : (
            <CommandMenuItemView
              key={`${item.type}-${index}`}
              item={item}
              onExecute={runtime.execute}
              renderIcon={renderIcon}
            />
          )
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
