import type {
  ActionAvailability,
  ActionAvailabilityInput,
  ActionDescriptor,
  ActionSurface,
  CommandDescriptor,
  MessageActionContext,
  MessageActionProvider,
  MessageActionReference,
  ResolvedAction,
  ResolvedActionConfirm
} from './actionTypes'

export type ActionRegistration = () => void

const DEFAULT_AVAILABILITY: ActionAvailability = {
  visible: true,
  enabled: true
}

function normalizeAvailability(input: ActionAvailabilityInput): ActionAvailability {
  if (input === false) return { visible: false, enabled: false }
  if (input === true || input === undefined) return DEFAULT_AVAILABILITY

  const visible = input.visible ?? true
  return {
    visible,
    enabled: visible ? (input.enabled ?? true) : false,
    ...(input.reason && { reason: input.reason })
  }
}

function combineAvailability(first: ActionAvailability, second: ActionAvailability): ActionAvailability {
  const visible = first.visible && second.visible
  return {
    visible,
    enabled: visible && first.enabled && second.enabled,
    ...(first.reason || second.reason ? { reason: first.reason ?? second.reason } : {})
  }
}

function matchesSurface<TContext>(action: ActionDescriptor<TContext>, surface?: ActionSurface): boolean {
  if (!surface || !action.surface) return true
  return Array.isArray(action.surface) ? action.surface.includes(surface) : action.surface === surface
}

function resolveNode<TContext>(node: ActionDescriptor<TContext>['label'], context: TContext) {
  return typeof node === 'function' ? node(context) : node
}

function resolveText<TContext>(text: string | ((context: TContext) => string), context: TContext): string {
  return typeof text === 'function' ? text(context) : text
}

function resolveConfirm<TContext>(
  confirm: ActionDescriptor<TContext>['confirm'],
  context: TContext
): ResolvedActionConfirm | undefined {
  if (!confirm) return undefined

  const resolved = typeof confirm === 'function' ? confirm(context) : confirm
  if (!resolved) return undefined

  return {
    title: resolveNode(resolved.title, context),
    ...(resolved.description && { description: resolveNode(resolved.description, context) }),
    ...(resolved.content && { content: resolveNode(resolved.content, context) }),
    ...(resolved.confirmText && { confirmText: resolveText(resolved.confirmText, context) }),
    ...(resolved.cancelText && { cancelText: resolveText(resolved.cancelText, context) }),
    ...(resolved.destructive !== undefined && { destructive: resolved.destructive })
  }
}

function sortResolvedActions<TContext>(actions: ResolvedAction<TContext>[]): ResolvedAction<TContext>[] {
  return actions.sort((first, second) => {
    const firstOrder = first.order ?? 0
    const secondOrder = second.order ?? 0
    if (firstOrder !== secondOrder) return firstOrder - secondOrder
    return first.id.localeCompare(second.id)
  })
}

export class ActionRegistry<TContext> {
  private readonly actions = new Map<string, ActionDescriptor<TContext>>()
  private readonly commands = new Map<string, CommandDescriptor<TContext>>()

  registerAction(descriptor: ActionDescriptor<TContext>): ActionRegistration {
    this.actions.set(descriptor.id, descriptor)

    return () => {
      if (this.actions.get(descriptor.id) === descriptor) {
        this.actions.delete(descriptor.id)
      }
    }
  }

  registerCommand(descriptor: CommandDescriptor<TContext>): ActionRegistration {
    this.commands.set(descriptor.id, descriptor)

    return () => {
      if (this.commands.get(descriptor.id) === descriptor) {
        this.commands.delete(descriptor.id)
      }
    }
  }

  unregister(id: string): void {
    this.actions.delete(id)
    this.commands.delete(id)
  }

  listActions(): ActionDescriptor<TContext>[] {
    return Array.from(this.actions.values())
  }

  listCommands(): CommandDescriptor<TContext>[] {
    return Array.from(this.commands.values())
  }

  resolve(context: TContext, surface?: ActionSurface): ResolvedAction<TContext>[] {
    return sortResolvedActions(
      this.listActions()
        .map((action) => this.resolveAction(action, context, surface))
        .filter((action): action is ResolvedAction<TContext> => !!action)
    )
  }

  async execute(actionId: string, context: TContext): Promise<boolean> {
    const action = this.findAction(actionId)
    if (!action) return false

    const resolvedAction = this.resolveAction(action, context)
    if (!resolvedAction?.availability.visible || !resolvedAction.availability.enabled) return false

    const commandId = resolvedAction.commandId
    if (!commandId) return false

    const command = this.commands.get(commandId)
    if (!command) return false

    await command.run(context)
    return true
  }

  clear(): void {
    this.actions.clear()
    this.commands.clear()
  }

  private findAction(actionId: string): ActionDescriptor<TContext> | undefined {
    for (const action of this.actions.values()) {
      const found = this.findActionInTree(action, actionId)
      if (found) return found
    }
    return undefined
  }

  private findActionInTree(
    action: ActionDescriptor<TContext>,
    actionId: string
  ): ActionDescriptor<TContext> | undefined {
    if (action.id === actionId) return action
    for (const child of action.children ?? []) {
      const found = this.findActionInTree(child, actionId)
      if (found) return found
    }
    return undefined
  }

  private resolveAction(
    action: ActionDescriptor<TContext>,
    context: TContext,
    surface?: ActionSurface
  ): ResolvedAction<TContext> | undefined {
    if (!matchesSurface(action, surface)) return undefined

    const commandAvailability = action.commandId
      ? normalizeAvailability(this.commands.get(action.commandId)?.availability?.(context))
      : DEFAULT_AVAILABILITY
    const actionAvailability = normalizeAvailability(action.availability?.(context))
    const availability = combineAvailability(actionAvailability, commandAvailability)
    if (!availability.visible) return undefined

    const children = sortResolvedActions(
      (action.children ?? [])
        .map((child) => this.resolveAction(child, context, surface))
        .filter((child): child is ResolvedAction<TContext> => !!child)
    )
    const confirm = resolveConfirm(action.confirm, context)

    return {
      id: action.id,
      ...(action.commandId && { commandId: action.commandId }),
      label: resolveNode(action.label, context),
      ...(action.icon && { icon: resolveNode(action.icon, context) }),
      ...(action.group && { group: action.group }),
      ...(action.order !== undefined && { order: action.order }),
      ...(action.surface && { surface: action.surface }),
      danger: action.danger ?? false,
      ...(action.shortcut && { shortcut: action.shortcut }),
      ...(confirm && { confirm }),
      availability,
      children
    }
  }
}

export function createActionRegistry<TContext>(): ActionRegistry<TContext> {
  return new ActionRegistry<TContext>()
}

export type MessageActionProviderRegistration = () => void

export class MessageActionRegistry {
  private readonly providers = new Map<string, MessageActionProvider>()
  private readonly registry = createActionRegistry<MessageActionContext>()

  registerAction(descriptor: ActionDescriptor<MessageActionContext>): ActionRegistration {
    return this.registry.registerAction(descriptor)
  }

  registerCommand(descriptor: CommandDescriptor<MessageActionContext>): ActionRegistration {
    return this.registry.registerCommand(descriptor)
  }

  register(provider: MessageActionProvider): MessageActionProviderRegistration {
    this.providers.set(provider.id, provider)

    return () => {
      if (this.providers.get(provider.id) === provider) {
        this.providers.delete(provider.id)
      }
    }
  }

  unregister(id: string): void {
    this.providers.delete(id)
    this.registry.unregister(id)
  }

  listProviders(): MessageActionProvider[] {
    return Array.from(this.providers.values())
  }

  resolve(context: MessageActionContext): MessageActionReference[] {
    return [...this.listProviders().flatMap((provider) => provider.resolve(context)), ...this.registry.resolve(context)]
  }

  async execute(actionId: string, context: MessageActionContext): Promise<boolean> {
    return this.registry.execute(actionId, context)
  }

  clear(): void {
    this.providers.clear()
    this.registry.clear()
  }
}

export function createMessageActionRegistry(): MessageActionRegistry {
  return new MessageActionRegistry()
}
