import type {
  DoctorCheckId,
  DoctorConfirmationCheckId,
  DoctorConfirmation,
  DoctorSubject,
  DoctorCheckOutcome,
  DoctorEvidenceItem,
  DoctorFixId,
  DoctorFixTarget
} from '@shared/types/doctor'

export interface DoctorContext {
  readonly subject?: DoctorSubject | null
  /** Aborted on the check's timeout or when the whole run is canceled; long probes should honour it. */
  readonly signal: AbortSignal
  /** Memoizes `factory` under `key` for the current run, so checks in different layers reuse one probe. */
  share<T>(key: string, factory: (signal: AbortSignal) => Promise<T>): Promise<T>
}

export type DoctorProbeOutcome<Id extends DoctorCheckId> = DoctorCheckOutcome<Id> & {
  readonly devMessage?: string
  readonly evidence?: readonly DoctorEvidenceItem[]
}

export type DoctorFixOutcome =
  | { readonly status: 'fixed' | 'requires_relaunch' }
  | { readonly status: 'failed'; readonly message: string }

export type DoctorFixContext<Id extends DoctorCheckId, Fix extends DoctorFixId<Id>> = DoctorContext &
  DoctorFixTarget<Id, Fix>

export type DoctorFixHandler<Id extends DoctorCheckId, Fix extends DoctorFixId<Id>> = (
  ctx: DoctorFixContext<Id, Fix>
) => Promise<DoctorFixOutcome>

/** A check implementation. Domain, tier, prerequisites and fix metadata live in the shared catalog. */
type DoctorCheckBaseDefinition<Id extends DoctorCheckId> = {
  readonly id: Id
  /** Overrides the tier default (quick 1s, live 15s, deep 60s). */
  readonly timeoutMs?: number
  run(ctx: DoctorContext): Promise<DoctorProbeOutcome<Id>>
  /** One handler per fix the catalog declares; `{}` when it declares none. */
  readonly fixes: { readonly [Fix in DoctorFixId<Id>]: DoctorFixHandler<Id, Fix> }
}

type AutomaticDefinition<Id extends DoctorCheckId> = DoctorCheckBaseDefinition<Id> & { getConfirmation?: never }
type ConfirmationDefinition<Id extends DoctorCheckId> = DoctorCheckBaseDefinition<Id> & {
  getConfirmation(ctx: DoctorContext): Promise<DoctorPreparedConfirmation<Id> | DoctorProbeOutcome<Id>>
}
export type DoctorCheckDefinition<Id extends DoctorCheckId> = Id extends DoctorConfirmationCheckId
  ? ConfirmationDefinition<Id>
  : AutomaticDefinition<Id>

export function defineDoctorCheck<Id extends Exclude<DoctorCheckId, DoctorConfirmationCheckId>>(
  def: AutomaticDefinition<Id>
): AutomaticDefinition<Id>
export function defineDoctorCheck<Id extends DoctorConfirmationCheckId>(
  def: ConfirmationDefinition<Id>
): ConfirmationDefinition<Id>
export function defineDoctorCheck(def: { readonly id: DoctorCheckId }) {
  return def
}

/** Exhaustive and closed: a catalog entry without an implementation (or vice versa) is a compile error. */
export type DoctorCheckRegistry = { readonly [Id in DoctorCheckId]: DoctorCheckDefinition<Id> }

/** Runtime validation stays in main; only the prompt is sent to the renderer. */
export interface DoctorPreparedConfirmation<Id extends DoctorCheckId = DoctorCheckId> {
  readonly confirmation: DoctorConfirmation<Id>
  isCurrent(): boolean
}

export interface DoctorEngineDefinition {
  readonly timeoutMs?: number
  run(ctx: DoctorContext): Promise<DoctorProbeOutcome<DoctorCheckId>>
  getConfirmation?(ctx: DoctorContext): Promise<DoctorPreparedConfirmation | DoctorProbeOutcome<DoctorCheckId>>
}
