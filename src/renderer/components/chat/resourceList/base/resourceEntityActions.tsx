import type {
  ActionAvailability,
  ActionDescriptor,
  ActionNode,
  ResolvedAction
} from '@renderer/components/chat/actions/actionTypes'

const DEFAULT_RESOLVED_ACTION_AVAILABILITY: ActionAvailability = {
  visible: true,
  enabled: true
}

type ResourceEntityMenuActionDescriptorParams<TContext> = Omit<ActionDescriptor<TContext>, 'surface'>

export function buildResourceEntityMenuActionDescriptor<TContext>({
  ...descriptor
}: ResourceEntityMenuActionDescriptorParams<TContext>): ActionDescriptor<TContext> {
  return {
    ...descriptor,
    surface: 'menu'
  }
}

type ResolvedResourceEntityMenuActionParams<TContext = unknown> = {
  id: string
  label: ResolvedAction<TContext>['label']
  availability?: ActionAvailability
  children?: ResolvedAction<TContext>[]
  commandId?: string
  danger?: boolean
  group?: string
  icon?: ResolvedAction<TContext>['icon']
  order?: number
}

export function buildResolvedResourceEntityMenuAction<TContext = unknown>({
  availability = DEFAULT_RESOLVED_ACTION_AVAILABILITY,
  children = [],
  danger = false,
  ...action
}: ResolvedResourceEntityMenuActionParams<TContext>): ResolvedAction<TContext> {
  return {
    ...action,
    danger,
    availability,
    children
  }
}

type ResourceEntityIconTypeActionDescriptorParams<TContext> = {
  id: string
  commandId?: string
  label: ActionNode<TContext>
  icon: ActionNode<TContext>
  order: number
  children: readonly ActionDescriptor<TContext>[]
}

export function buildResourceEntityIconTypeActionDescriptor<TContext>(
  params: ResourceEntityIconTypeActionDescriptorParams<TContext>
): ActionDescriptor<TContext> {
  return buildResourceEntityMenuActionDescriptor(params)
}
