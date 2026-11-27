import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ContextReader, RegisteredCommandDefinition, SupportedPlatform } from '@shared/types/command'
import {
  type CommandId,
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
