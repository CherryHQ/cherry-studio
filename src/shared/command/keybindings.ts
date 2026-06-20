import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { normalizeShortcutBinding, type ShortcutBinding } from '@shared/shortcuts/tokens'

import { canContextExprsOverlap, evaluateContextExpr } from './contextExpr'
import { type CommandId, findKeybindingRule, REGISTERED_KEYBINDINGS } from './definitions'
import type { CommandScope, ContextReader, RegisteredKeybindingRule, SupportedPlatform } from './types'

export interface ResolveCommandKeybindingOptions {
  command: CommandId
  preference?: PreferenceShortcutType | null
  context: ContextReader
  platform?: SupportedPlatform
}

export interface ResolvedCommandKeybinding {
  command: CommandId
  binding: ShortcutBinding
  enabled: boolean
  accelerator?: string
  additionalBindings: readonly ShortcutBinding[]
}

export interface ResolvedCommandShortcutPreference {
  binding: ShortcutBinding
  enabled: boolean
}

export interface ResolveCommandByKeybindingOptions {
  binding: ShortcutBinding
  preferences?: Partial<Record<CommandId, PreferenceShortcutType | null | undefined>>
  context: ContextReader
  platform?: SupportedPlatform
  scope?: CommandScope
  canExecuteCommand?: (command: CommandId) => boolean
}

export type KeybindingTriggerSource = 'primary' | 'additional'

export interface KeybindingConflict {
  command: CommandId
  conflictingCommand: CommandId
  binding: ShortcutBinding
  conflictingBinding: ShortcutBinding
  trigger: KeybindingTriggerSource
  conflictingTrigger: KeybindingTriggerSource
}

export interface FindKeybindingConflictsOptions {
  command: CommandId
  preference: PreferenceShortcutType
  preferences?: Partial<Record<CommandId, PreferenceShortcutType | null | undefined>>
  platform?: SupportedPlatform
  rules?: readonly RegisteredKeybindingRule<CommandId>[]
}

const isPlatformSupported = (rule: RegisteredKeybindingRule, platform?: SupportedPlatform): boolean => {
  if (!rule.supportedPlatforms?.length || !platform) {
    return true
  }
  return rule.supportedPlatforms.includes(platform)
}

const isScopeSupported = (rule: RegisteredKeybindingRule, scope?: CommandScope): boolean => {
  if (!scope) {
    return true
  }
  return rule.scope === scope || rule.scope === 'both'
}

const scopesOverlap = (left: CommandScope, right: CommandScope): boolean =>
  left === right || left === 'both' || right === 'both'

const platformsOverlap = (
  left?: readonly SupportedPlatform[],
  right?: readonly SupportedPlatform[],
  platform?: SupportedPlatform
): boolean => {
  if (platform) {
    const leftSupportsPlatform = !left?.length || left.includes(platform)
    const rightSupportsPlatform = !right?.length || right.includes(platform)
    return leftSupportsPlatform && rightSupportsPlatform
  }

  if (!left?.length || !right?.length) {
    return true
  }

  return left.some((item) => right.includes(item))
}

const shortcutBindingMatches = (left: ShortcutBinding, right: ShortcutBinding): boolean => {
  if (left.length !== right.length) {
    return false
  }

  const leftTokens = new Set(left)
  if (leftTokens.size !== right.length) {
    return false
  }

  return right.every((token) => leftTokens.has(token))
}

const getTriggerBindings = (
  binding: ShortcutBinding,
  additionalBindings: readonly ShortcutBinding[] = []
): { binding: ShortcutBinding; trigger: KeybindingTriggerSource }[] => [
  { binding, trigger: 'primary' },
  ...additionalBindings.map((additionalBinding) => ({ binding: additionalBinding, trigger: 'additional' as const }))
]

export const getCommandAccelerator = (binding: ShortcutBinding): string | undefined => {
  if (!binding.length) {
    return undefined
  }
  return binding.join('+')
}

const getDefaultShortcutPreferenceForRule = (rule: RegisteredKeybindingRule): ResolvedCommandShortcutPreference => {
  const fallback = DefaultPreferences.default[rule.preferenceKey]

  return {
    binding: fallback?.binding?.length ? normalizeShortcutBinding(fallback.binding) : rule.defaultBinding,
    enabled: typeof fallback?.enabled === 'boolean' ? fallback.enabled : true
  }
}

export const getCommandDefaultShortcutPreference = (
  command: CommandId
): ResolvedCommandShortcutPreference | undefined => {
  const rule = findKeybindingRule(command)
  if (!rule) {
    return undefined
  }
  return getDefaultShortcutPreferenceForRule(rule)
}

export const resolveCommandShortcutPreference = (
  command: CommandId,
  preference?: PreferenceShortcutType | null
): ResolvedCommandShortcutPreference | undefined => {
  const rule = findKeybindingRule(command)
  if (!rule) {
    return undefined
  }

  const fallback = getDefaultShortcutPreferenceForRule(rule)
  const binding: ShortcutBinding =
    preference != null
      ? preference.binding?.length
        ? normalizeShortcutBinding(preference.binding)
        : []
      : fallback.binding

  return {
    binding,
    enabled: typeof preference?.enabled === 'boolean' ? preference.enabled : fallback.enabled
  }
}

export const resolveCommandKeybinding = ({
  command,
  preference,
  context,
  platform
}: ResolveCommandKeybindingOptions): ResolvedCommandKeybinding | undefined => {
  const rule = findKeybindingRule(command)
  if (!rule || !isPlatformSupported(rule, platform) || !evaluateContextExpr(rule.when, context)) {
    return undefined
  }

  const shortcutPreference = resolveCommandShortcutPreference(command, preference)
  if (!shortcutPreference) {
    return undefined
  }

  return {
    command,
    binding: shortcutPreference.binding,
    enabled: shortcutPreference.enabled,
    accelerator: shortcutPreference.enabled ? getCommandAccelerator(shortcutPreference.binding) : undefined,
    additionalBindings: rule.additionalBindings ?? []
  }
}

export const resolveCommandByKeybinding = ({
  binding,
  preferences,
  context,
  platform,
  scope,
  canExecuteCommand
}: ResolveCommandByKeybindingOptions): CommandId | undefined => {
  if (!binding.length) {
    return undefined
  }

  for (const rule of REGISTERED_KEYBINDINGS) {
    if (!isScopeSupported(rule, scope)) {
      continue
    }
    if (!isPlatformSupported(rule, platform) || !evaluateContextExpr(rule.when, context)) {
      continue
    }
    if (canExecuteCommand && !canExecuteCommand(rule.command)) {
      continue
    }

    const resolved = resolveCommandKeybinding({
      command: rule.command,
      preference: preferences?.[rule.command],
      context,
      platform
    })
    if (!resolved?.enabled || !resolved.binding.length) {
      continue
    }

    const triggerBindings = [resolved.binding, ...resolved.additionalBindings]
    if (triggerBindings.some((triggerBinding) => shortcutBindingMatches(binding, triggerBinding))) {
      return rule.command
    }
  }

  return undefined
}

export const findKeybindingConflicts = ({
  command,
  preference,
  preferences,
  platform,
  rules = REGISTERED_KEYBINDINGS
}: FindKeybindingConflictsOptions): KeybindingConflict[] => {
  const commandRule = rules.find((rule) => rule.command === command)
  if (
    !commandRule ||
    !preference.enabled ||
    !preference.binding.length ||
    !isPlatformSupported(commandRule, platform)
  ) {
    return []
  }

  const candidateBinding = normalizeShortcutBinding(preference.binding)
  const candidateTriggers = getTriggerBindings(candidateBinding, commandRule.additionalBindings)
  const preferenceLookup = {
    ...preferences,
    [command]: {
      ...preference,
      binding: candidateBinding
    }
  }
  const conflicts: KeybindingConflict[] = []

  for (const rule of rules) {
    if (rule.command === command) {
      continue
    }
    if (!scopesOverlap(commandRule.scope, rule.scope)) {
      continue
    }
    if (!platformsOverlap(commandRule.supportedPlatforms, rule.supportedPlatforms, platform)) {
      continue
    }
    if (!canContextExprsOverlap(commandRule.when, rule.when)) {
      continue
    }

    const conflictingPreference = resolveCommandShortcutPreference(rule.command, preferenceLookup[rule.command])
    if (!conflictingPreference?.enabled || !conflictingPreference.binding.length) {
      continue
    }

    const conflictingTriggers = getTriggerBindings(
      normalizeShortcutBinding(conflictingPreference.binding),
      rule.additionalBindings
    )

    for (const candidate of candidateTriggers) {
      for (const conflicting of conflictingTriggers) {
        if (shortcutBindingMatches(candidate.binding, conflicting.binding)) {
          conflicts.push({
            command,
            conflictingCommand: rule.command,
            binding: candidate.binding,
            conflictingBinding: conflicting.binding,
            trigger: candidate.trigger,
            conflictingTrigger: conflicting.trigger
          })
        }
      }
    }
  }

  return conflicts
}
