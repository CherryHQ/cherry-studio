/**
 * Profile activation model (RFC §4.2). A separate axis from {@link Activatable}
 * (on-demand feature activation): a service may implement both. IPC handlers
 * registered in onInit stay registered regardless of profile binding — only the
 * per-profile resources are acquired/released here.
 */

/** Identifies the profile a hook is acting on. */
export interface ProfileActivationContext {
  readonly profileId: string
}

/**
 * Implemented by services that own per-profile resources (DB connection, caches,
 * watchers, streams). The container binds/releases them as the active profile
 * changes; boot is the first activation.
 *
 * Contract (mirrors Activatable): if a hook throws after partially allocating
 * resources it MUST release them before throwing — activation may be retried.
 */
export interface ProfileActivatable {
  /** Acquire resources for `ctx.profileId`. Awaited by the orchestrator. */
  onProfileActivate(ctx: ProfileActivationContext): Promise<void> | void
  /** Release the current profile's resources. Awaited by the orchestrator. */
  onProfileDeactivate(ctx: ProfileActivationContext): Promise<void> | void
}

/** Duck-typed guard: does `service` participate in profile activation? */
export function isProfileActivatable(service: unknown): service is ProfileActivatable {
  return (
    typeof service === 'object' &&
    service !== null &&
    'onProfileActivate' in service &&
    'onProfileDeactivate' in service &&
    typeof (service as ProfileActivatable).onProfileActivate === 'function' &&
    typeof (service as ProfileActivatable).onProfileDeactivate === 'function'
  )
}

/**
 * A service's activation state: unbound, or bound to exactly one profile. A sum
 * type so "bound but no profileId" / "unbound but retains a profileId" cannot be
 * represented.
 */
export type ProfileBinding = { readonly kind: 'unbound' } | { readonly kind: 'bound'; readonly profileId: string }

/** The side effect the interpreter must run to reach the requested state. */
export type ActivationEffect = 'none' | 'acquire' | 'release-then-acquire' | 'release'

/**
 * Pure decision: the effect that converges `binding` to `bound(target)`. Bound
 * to a different profile → release then acquire (this convergence is what makes
 * `activate(P)` reach `bound(P)` from any prior state, so rollback is just
 * re-activating the previous profile).
 */
export function decideActivate(binding: ProfileBinding, target: string): ActivationEffect {
  if (binding.kind === 'unbound') return 'acquire'
  if (binding.profileId === target) return 'none'
  return 'release-then-acquire'
}

/** Pure decision: the effect that releases `binding`. */
export function decideDeactivate(binding: ProfileBinding): ActivationEffect {
  return binding.kind === 'bound' ? 'release' : 'none'
}
