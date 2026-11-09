import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ContextReader, RegisteredCommandDefinition, SupportedPlatform } from '@shared/types/command'
import {
  type CommandId,
  type COMMAND_DEFINITIONS,
  evaluateContextExpr,
  findCommandDefinition,
  findKeybindingRule,
  getCommandAccelerator,
  isPlatformSupported,
  resolveCommandShortcutPreference,
  type ResolvedCommandKeybinding
} from '@shared/utils/command'
import { formatShortcutDisplay } from '@shared/utils/shortcut'

/**
 * Renderer-only command presentation helpers. Cross-process shortcut parsing
 * and command resolution live in the shared layer.
 */

/** Configured bindings remain visible when their keyboard-only context is inactive. */
export const resolveCommandPresentationKeybinding = (
  command: CommandId,
  preference: PreferenceShortcutType | null | undefined,
  options: { context: ContextReader; platform?: SupportedPlatform }
): ResolvedCommandKeybinding | undefined => {
  const definition = findCommandDefinition(command)
  const rule = findKeybindingRule(command)
  if (
    !rule ||
    !isPlatformSupported(rule, options.platform) ||
    !evaluateContextExpr(definition?.enablement, options.context)
  ) {
    return undefined
  }

  const shortcut = resolveCommandShortcutPreference(command, preference, options.platform)
  if (!shortcut) return undefined
  return {
    command,
    ...shortcut,
    accelerator: shortcut.enabled ? getCommandAccelerator(shortcut.binding) : undefined,
    additionalBindings: rule.additionalBindings ?? []
  }
}

export const getCommandShortcutLabel = (
  command: CommandId,
  preference: PreferenceShortcutType | null | undefined,
  options: {
    context: ContextReader
    isMac: boolean
    platform?: SupportedPlatform
  }
): string => {
  const resolved = resolveCommandPresentationKeybinding(command, preference, options)

  if (!resolved?.enabled || !resolved.binding.length) {
    return ''
  }

  return formatShortcutDisplay(resolved.binding, options.isMac)
}

export interface CommandDisplayState {
  label: string
  enabled: boolean
  iconKey?: string
  shortcutLabel: string
}

/**
 * Shared per-command display computation used by {@link useResolvedCommand} and
 * {@link useResolvedCommandMenu}. Renderer concerns (`hasHandler`, `translate`)
 * are injected so the function stays pure.
 */
export const resolveCommandDisplayState = (
  command: CommandId,
  options: {
    definition: RegisteredCommandDefinition<CommandId> | undefined
    preference: PreferenceShortcutType | null | undefined
    context: ContextReader
    hasHandler: (command: CommandId) => boolean
    translate: (key: string) => string
    isMac: boolean
    platform?: SupportedPlatform
  }
): CommandDisplayState => {
  const { definition, preference, context, hasHandler, translate } = options

  return {
    label: definition ? translate(definition.titleKey) : command,
    enabled: Boolean(definition && hasHandler(command) && evaluateContextExpr(definition.enablement, context)),
    iconKey: definition?.iconKey,
    shortcutLabel: getCommandShortcutLabel(command, preference, {
      context,
      isMac: options.isMac,
      platform: options.platform
    })
  }
}

// UI target scope is renderer-owned and independent of the shared process scope.
type RendererCommandId = Extract<(typeof COMMAND_DEFINITIONS)[number], { scope: 'renderer' | 'both' }>['id']
type CommandTarget = 'focused' | 'active-tab' | 'window'

export const RENDERER_COMMAND_TARGETS: ReadonlyMap<string, CommandTarget> = new Map(
  Object.entries({
    'app.fullscreen.exit': 'window',
    'app.search': 'window',
    'app.print': 'focused',
    'app.sidebar.toggle': 'focused',
    'app.sidebar.open_1': 'active-tab',
    'app.sidebar.open_2': 'active-tab',
    'app.sidebar.open_3': 'active-tab',
    'app.sidebar.open_4': 'active-tab',
    'app.sidebar.open_5': 'active-tab',
    'app.sidebar.open_6': 'active-tab',
    'app.sidebar.open_7': 'active-tab',
    'app.sidebar.open_8': 'active-tab',
    'app.sidebar.open_9': 'active-tab',
    'agent.workspace.open': 'focused',
    'chat.input.focus': 'focused',
    'chat.context.toggle_new': 'focused',
    'chat.message.copy_last': 'focused',
    'chat.message.edit_last_user': 'focused',
    'chat.message.search': 'focused',
    'chat.model.select': 'focused',
    'topic.clear_messages': 'focused',
    'topic.create': 'focused',
    'topic.rename': 'focused',
    'topic.sidebar.toggle': 'focused',
    'resource.delete_permanently': 'focused',
    'assistant.next': 'focused',
    'assistant.prev': 'focused',
    'topic.next': 'focused',
    'topic.prev': 'focused',
    'tab.close': 'window',
    'tab.open_1': 'window',
    'tab.open_2': 'window',
    'tab.open_3': 'window',
    'tab.open_4': 'window',
    'tab.open_5': 'window',
    'tab.open_6': 'window',
    'tab.open_7': 'window',
    'tab.open_8': 'window',
    'tab.open_9': 'window',
    'tab.next': 'window',
    'tab.prev': 'window'
  } satisfies Record<RendererCommandId, CommandTarget>)
)
