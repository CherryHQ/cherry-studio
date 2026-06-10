import { evaluateContextExpr, parseContextExpr } from './contextExpr'
import { type CommandId, findCommandDefinition } from './definitions'
import type {
  ContextReader,
  MenuContribution,
  MenuLocation,
  MenuPresentationMode,
  RegisteredMenuContribution,
  ResolvedMenuItem,
  ResolvedMenuModel
} from './types'

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

const registerMenuContribution = (
  contribution: MenuContribution<CommandId>
): RegisteredMenuContribution<CommandId> => ({
  ...contribution,
  when: contribution.when ? parseContextExpr(contribution.when) : undefined,
  whenSource: contribution.when
})

export class MenuRegistry {
  private contributions: RegisteredMenuContribution<CommandId>[] = []

  constructor(contributions: readonly MenuContribution<CommandId>[] = []) {
    for (const contribution of contributions) {
      this.register(contribution)
    }
  }

  register(contribution: MenuContribution<CommandId>): void {
    if (!findCommandDefinition(contribution.command)) {
      throw new Error(`Cannot register menu contribution for unknown command: ${contribution.command}`)
    }
    this.contributions.push(registerMenuContribution(contribution))
  }

  resolve({ location, context, getCommandState }: ResolveMenuOptions): ResolvedMenuModel<CommandId> {
    const items: ResolvedMenuItem<CommandId>[] = []
    let previousGroup: string | null = null

    const contributions = this.contributions
      .filter((contribution) => contribution.location === location)
      .filter((contribution) => evaluateContextExpr(contribution.when, context))
      .sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.command.localeCompare(b.command))

    for (const contribution of contributions) {
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
}

export const menuRegistry = new MenuRegistry(MENU_CONTRIBUTIONS)
