import type {
  ContextReader,
  MenuContribution,
  MenuLocation,
  MenuPresentationMode,
  RegisteredMenuContribution,
  ResolvedMenuItem,
  ResolvedMenuModel
} from '@shared/types/command'

import { evaluateContextExpr, parseContextExpr } from './contextExpr'
import { type CommandId, findCommandDefinition } from './definitions'

export interface CommandMenuState {
  label: string
  enabled: boolean
  checked?: boolean
  destructive?: boolean
  iconKey?: string
  shortcutLabel?: string
  accelerator?: string
}

export interface ResolveMenuOptions {
  location: MenuLocation
  context: ContextReader
  getCommandState: (command: CommandId) => CommandMenuState
}

export const resolveMenuPresentationMode = (
  location: MenuLocation,
  preferredMode: MenuPresentationMode
): MenuPresentationMode => {
  if (location === 'app.menu' || location === 'tray.menu') {
    return 'native'
  }
  return preferredMode
}

export const MENU_CONTRIBUTIONS = [
  { location: 'app.menu', command: 'app.settings.open', group: 'app', order: 10 },
  { location: 'app.menu', command: 'app.zoom.reset', group: 'view', order: 10 },
  { location: 'app.menu', command: 'app.zoom.in', group: 'view', order: 20 },
  { location: 'app.menu', command: 'app.zoom.out', group: 'view', order: 30 },
  { location: 'command.palette', command: 'app.search', group: 'navigation', order: 10 },
  { location: 'command.palette', command: 'topic.create', group: 'topic', order: 10 },
  { location: 'chat.input.tools.context', command: 'topic.create', group: 'chat', order: 10 },
  { location: 'chat.input.toolbar', command: 'topic.create', group: 'topic', order: 10 }
] as const satisfies readonly MenuContribution<CommandId>[]

const registerMenuContribution = (contribution: MenuContribution<CommandId>): RegisteredMenuContribution<CommandId> => {
  if (!findCommandDefinition(contribution.command)) {
    throw new Error(`Cannot register menu contribution for unknown command: ${contribution.command}`)
  }
  return {
    ...contribution,
    when: contribution.when ? parseContextExpr(contribution.when) : undefined,
    whenSource: contribution.when
  }
}

/** Pure resolve over an already-registered contribution set — shared by `MenuRegistry` and `resolveMenu`. */
const resolveContributions = (
  contributions: readonly RegisteredMenuContribution<CommandId>[],
  { location, context, getCommandState }: ResolveMenuOptions
): ResolvedMenuModel<CommandId> => {
  const items: ResolvedMenuItem<CommandId>[] = []
  let previousGroup: string | null = null

  const matched = contributions
    .filter((contribution) => contribution.location === location)
    .filter((contribution) => evaluateContextExpr(contribution.when, context))
    .sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.command.localeCompare(b.command))

  for (const contribution of matched) {
    if (previousGroup && previousGroup !== contribution.group) {
      items.push({ type: 'separator' })
    }

    const state = getCommandState(contribution.command)
    items.push({
      type: 'command',
      command: contribution.command,
      label: state.label,
      enabled: state.enabled,
      checked: state.checked,
      destructive: state.destructive,
      iconKey: state.iconKey,
      shortcutLabel: state.shortcutLabel ?? '',
      accelerator: state.accelerator
    })
    previousGroup = contribution.group
  }

  return { location, items }
}

/**
 * Blueprint for a mutable menu registry (dynamic registration). `@shared` exports no
 * registry *instance* (separate per-process V8 realms make a "shared singleton" a fiction);
 * each process constructs its own when it needs dynamic registration. For the static
 * built-in menu model use the pure `resolveMenu` below.
 */
export class MenuRegistry {
  private contributions: RegisteredMenuContribution<CommandId>[] = []

  constructor(contributions: readonly MenuContribution<CommandId>[] = []) {
    for (const contribution of contributions) {
      this.register(contribution)
    }
  }

  register(contribution: MenuContribution<CommandId>): void {
    this.contributions.push(registerMenuContribution(contribution))
  }

  resolve(options: ResolveMenuOptions): ResolvedMenuModel<CommandId> {
    return resolveContributions(this.contributions, options)
  }
}

/** The static built-in menu contributions, registered once at module load (immutable). */
const REGISTERED_MENU_CONTRIBUTIONS: readonly RegisteredMenuContribution<CommandId>[] =
  MENU_CONTRIBUTIONS.map(registerMenuContribution)

/** Resolve the built-in menu model for a location — pure, no exported instance (Invariant 1.2). */
export const resolveMenu = (options: ResolveMenuOptions): ResolvedMenuModel<CommandId> =>
  resolveContributions(REGISTERED_MENU_CONTRIBUTIONS, options)
