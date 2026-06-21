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
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { isMac, platform } from '@renderer/config/constant'
import {
  useCommandContextReader,
  useCommandMenuPresentationMode,
  useCommandRuntime,
  useCommandShortcutPreferences,
  useResolvedCommandMenu
} from '@renderer/hooks/command'
import { getCommandShortcutLabel } from '@renderer/utils/command'
import type {
  MenuLocation,
  NativePopupMenuItem,
  NativePopupMenuModel,
  ResolvedMenuItem,
  SupportedPlatform
} from '@shared/types/command'
import { type CommandId, findKeybindingRule, resolveMenuPresentationMode } from '@shared/utils/command'
import React, { useCallback, useMemo, useRef, useState } from 'react'

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

const hasShortcutCommands = (items: readonly CommandContextMenuExtraItem[]): boolean =>
  items.some(
    (item) =>
      (item.type === 'item' && item.shortcutCommand !== undefined) ||
      (item.type === 'submenu' && hasShortcutCommands(item.children))
  )

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

function CommandMenuItemView({
  item,
  onExecute,
  onSelectItem,
  renderIcon
}: {
  item: ResolvedMenuItem<CommandId>
  onExecute: (command: CommandId) => void
  onSelectItem?: (action: () => void) => void
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
              onSelectItem={onSelectItem}
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
        onCheckedChange={() => (onSelectItem ? onSelectItem(() => onExecute(item.command)) : onExecute(item.command))}>
        {content}
      </ContextMenuCheckboxItem>
    )
  }

  return (
    <ContextMenuItem
      disabled={!item.enabled}
      variant={item.destructive ? 'destructive' : 'default'}
      onSelect={() => (onSelectItem ? onSelectItem(() => onExecute(item.command)) : onExecute(item.command))}>
      {content}
    </ContextMenuItem>
  )
}

function CommandContextMenuExtraItemView({
  item,
  onSelectItem
}: {
  item: CommandContextMenuExtraItem
  onSelectItem?: (action: () => void) => void
}): React.ReactNode {
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
            <CommandContextMenuExtraItemView key={`${child.type}-${index}`} item={child} onSelectItem={onSelectItem} />
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    )
  }

  return (
    <ContextMenuItem
      disabled={item.enabled === false}
      variant={item.destructive ? 'destructive' : 'default'}
      onSelect={() => (onSelectItem ? onSelectItem(item.onSelect) : item.onSelect())}>
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
  const preferredMode = useCommandMenuPresentationMode()
  const context = useCommandContextReader()
  const shortcutPreferences = useCommandShortcutPreferences()
  const [resolvedExtraItems, setResolvedExtraItems] = useState<readonly CommandContextMenuExtraItem[] | null>(null)
  const extraItemsRequestIdRef = useRef(0)
  const runtime = useCommandRuntime()
  const model = useResolvedCommandMenu(location)
  const mode = resolveMenuPresentationMode(location, preferredMode ?? 'cherry')
  const commandItems = useMemo(() => removeEmptySeparators(model.items), [model.items])
  const pendingItems = pendingExtraItems ?? extraItems
  const resolveShortcutLabel = useCallback(
    (command: CommandId) => {
      const rule = findKeybindingRule(command)
      const preference = rule ? shortcutPreferences[command] : undefined

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
      if (!hasShortcutCommands(items)) return items
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

      let resolved: MaybePromise<readonly CommandContextMenuExtraItem[]>
      try {
        resolved = getExtraItems(event)
      } catch (error) {
        logger.warn('Failed to resolve command menu extra items', error as Error)
        setResolvedExtraItems(EMPTY_EXTRA_ITEMS)
        return
      }

      // Apply sync results immediately so the menu opens with items in the same tick
      // (otherwise tests that fire contextMenu + assert synchronously would miss them).
      if (!(resolved instanceof Promise) && typeof (resolved as PromiseLike<unknown>)?.then !== 'function') {
        setResolvedExtraItems(resolved as readonly CommandContextMenuExtraItem[])
        return
      }

      setResolvedExtraItems(pendingItems)
      void Promise.resolve(resolved)
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

  const handleCherrySelectItem = useCallback(
    (action: () => void) => {
      handleCherryOpenChange(false)
      queueMicrotask(action)
    },
    [handleCherryOpenChange]
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
        logger.error('Failed to resolve command menu extra items', error as Error)
        nativeExtraItems = EMPTY_EXTRA_ITEMS
      }

      void Promise.resolve(nativeExtraItems)
        .catch((error) => {
          logger.error('Failed to resolve command menu extra items', error as Error)
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
            <CommandContextMenuExtraItemView
              key={`extra-${item.id}`}
              item={item}
              onSelectItem={handleCherrySelectItem}
            />
          ) : (
            <CommandMenuItemView
              key={`${item.type}-${index}`}
              item={item}
              onExecute={runtime.execute}
              onSelectItem={handleCherrySelectItem}
              renderIcon={renderIcon}
            />
          )
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function CommandDropdownMenuItemView({
  item,
  onExecute,
  onSelectItem,
  renderIcon
}: {
  item: ResolvedMenuItem<CommandId>
  onExecute: (command: CommandId) => void
  onSelectItem?: (action: () => void) => void
  renderIcon?: CommandIconRenderer
}): React.ReactNode {
  if (item.type === 'separator') {
    return <DropdownMenuSeparator />
  }

  if (item.type === 'submenu') {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!item.enabled}>
          <ContextMenuItemContent icon={renderIcon?.(item.iconKey)}>{item.label}</ContextMenuItemContent>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {item.children.map((child, index) => (
            <CommandDropdownMenuItemView
              key={`${child.type}-${index}`}
              item={child}
              onExecute={onExecute}
              onSelectItem={onSelectItem}
              renderIcon={renderIcon}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  const content = (
    <ContextMenuItemContent icon={renderIcon?.(item.iconKey)} shortcut={item.shortcutLabel || undefined}>
      {item.label}
    </ContextMenuItemContent>
  )

  if (item.checked !== undefined) {
    return (
      <DropdownMenuCheckboxItem
        checked={item.checked}
        disabled={!item.enabled}
        onCheckedChange={() => (onSelectItem ? onSelectItem(() => onExecute(item.command)) : onExecute(item.command))}>
        {content}
      </DropdownMenuCheckboxItem>
    )
  }

  return (
    <DropdownMenuItem
      disabled={!item.enabled}
      variant={item.destructive ? 'destructive' : 'default'}
      onSelect={() => (onSelectItem ? onSelectItem(() => onExecute(item.command)) : onExecute(item.command))}>
      {content}
    </DropdownMenuItem>
  )
}

function CommandDropdownExtraItemView({
  item,
  onSelectItem
}: {
  item: CommandContextMenuExtraItem
  onSelectItem?: (action: () => void) => void
}): React.ReactNode {
  if (item.type === 'separator') {
    return <DropdownMenuSeparator />
  }

  if (item.type === 'submenu') {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={item.enabled === false}>
          <ContextMenuItemContent icon={item.icon}>{item.label}</ContextMenuItemContent>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {item.children.map((child, index) => (
            <CommandDropdownExtraItemView key={`${child.type}-${index}`} item={child} onSelectItem={onSelectItem} />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  return (
    <DropdownMenuItem
      disabled={item.enabled === false}
      variant={item.destructive ? 'destructive' : 'default'}
      onSelect={() => (onSelectItem ? onSelectItem(item.onSelect) : item.onSelect())}>
      <ContextMenuItemContent icon={item.icon} badge={item.badge} shortcut={item.shortcutLabel || undefined}>
        {item.label}
      </ContextMenuItemContent>
    </DropdownMenuItem>
  )
}

/**
 * Click-triggered sibling of {@link CommandContextMenu}. Renders the same item
 * model through Radix DropdownMenu in cherry mode, and (when location resolves
 * to native) anchors a native OS popup at the trigger's bounding rect. Use this
 * for "more" buttons so they share the same menu pipeline as right-click.
 */
export function CommandPopupMenu({
  location,
  children,
  align,
  side,
  sideOffset,
  contentClassName,
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  renderIcon,
  extraItems = EMPTY_EXTRA_ITEMS
}: {
  location: MenuLocation
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  contentClassName?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  renderIcon?: CommandIconRenderer
  extraItems?: readonly CommandContextMenuExtraItem[]
}): React.ReactNode {
  const preferredMode = useCommandMenuPresentationMode()
  const context = useCommandContextReader()
  const shortcutPreferences = useCommandShortcutPreferences()
  const runtime = useCommandRuntime()
  const model = useResolvedCommandMenu(location)
  const mode = resolveMenuPresentationMode(location, preferredMode ?? 'cherry')
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)
  const currentOpen = open ?? internalOpen
  const commandItems = useMemo(() => removeEmptySeparators(model.items), [model.items])
  const resolveShortcutLabel = useCallback(
    (command: CommandId) => {
      const rule = findKeybindingRule(command)
      const preference = rule ? shortcutPreferences[command] : undefined
      return getCommandShortcutLabel(command, preference, {
        context,
        isMac,
        platform: platform as SupportedPlatform
      })
    },
    [context, shortcutPreferences]
  )
  const decoratedExtraItems = useMemo<readonly CommandContextMenuExtraItem[]>(() => {
    if (!hasShortcutCommands(extraItems)) return extraItems
    const decorate = (source: readonly CommandContextMenuExtraItem[]): CommandContextMenuExtraItem[] =>
      source.map((item) => {
        if (item.type === 'submenu') {
          return { ...item, children: decorate(item.children) }
        }
        if (item.type !== 'item' || !item.shortcutCommand) {
          return item
        }
        return {
          ...item,
          shortcutLabel: item.shortcutLabel || resolveShortcutLabel(item.shortcutCommand) || undefined
        }
      })
    return decorate(extraItems)
  }, [extraItems, resolveShortcutLabel])
  const combinedItems = useMemo<readonly CommandContextMenuItem[]>(
    () => combineContextMenuItems(commandItems, decoratedExtraItems),
    [commandItems, decoratedExtraItems]
  )

  const handleNativeClick = useCallback(
    async (event: React.MouseEvent) => {
      if (mode !== 'native') return
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const anchor = { x: Math.round(rect.left), y: Math.round(rect.bottom) }
      const nativeItems = combinedItems.map(toNativePopupMenuItem)
      if (!nativeItems.length) return
      const model: NativePopupMenuModel<CommandId> = { location, items: nativeItems }
      try {
        const result = await window.api.command.showNativePopupMenu(model, anchor)
        if (result?.type === 'command') {
          runtime.execute(result.command)
        } else if (result?.type === 'custom') {
          getExtraItemActions(decoratedExtraItems).get(result.id)?.()
        }
      } catch (error) {
        logger.error('Failed to show native command popup menu', error as Error)
      }
    },
    [combinedItems, decoratedExtraItems, location, mode, runtime]
  )

  const handleCherryOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, open]
  )

  const handleCherrySelectItem = useCallback(
    (action: () => void) => {
      handleCherryOpenChange(false)
      queueMicrotask(action)
    },
    [handleCherryOpenChange]
  )

  if (disabled || combinedItems.length === 0) {
    return <>{children}</>
  }

  if (mode === 'native') {
    // asChild clone preserves the trigger's own onClick (e.g. stopPropagation) while
    // attaching the native-popup handler on the same element — wrapping in a parent
    // span would be blocked by the child's stopPropagation.
    if (React.isValidElement(children)) {
      const childProps = (children.props ?? {}) as { onClick?: (event: React.MouseEvent) => void }
      return React.cloneElement(children as React.ReactElement<{ onClick?: (event: React.MouseEvent) => void }>, {
        onClick: (event: React.MouseEvent) => {
          childProps.onClick?.(event)
          if (!event.defaultPrevented) {
            void handleNativeClick(event)
          }
        }
      })
    }
    return <>{children}</>
  }

  return (
    <DropdownMenu open={currentOpen} onOpenChange={handleCherryOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} sideOffset={sideOffset} className={contentClassName}>
        {combinedItems.map((item, index) =>
          isExtraMenuItem(item) ? (
            <CommandDropdownExtraItemView key={`extra-${item.id}`} item={item} onSelectItem={handleCherrySelectItem} />
          ) : (
            <CommandDropdownMenuItemView
              key={`${item.type}-${index}`}
              item={item}
              onExecute={runtime.execute}
              onSelectItem={handleCherrySelectItem}
              renderIcon={renderIcon}
            />
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
