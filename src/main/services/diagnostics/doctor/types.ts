import type {
  DoctorCheckId,
  DoctorCheckOutcome,
  DoctorEvidenceItem,
  DoctorFixId,
  DoctorFixTarget
} from '@shared/types/doctor'

export interface DoctorContext {
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
export interface DoctorCheckDefinition<Id extends DoctorCheckId> {
  readonly id: Id
  /** Overrides the tier default (quick 1s, live 15s, deep 60s). */
  readonly timeoutMs?: number
  run(ctx: DoctorContext): Promise<DoctorProbeOutcome<Id>>
  /** One handler per fix the catalog declares; `{}` when it declares none. */
  readonly fixes: { readonly [Fix in DoctorFixId<Id>]: DoctorFixHandler<Id, Fix> }
}

export const defineDoctorCheck = <Id extends DoctorCheckId>(def: DoctorCheckDefinition<Id>) => def

/** Exhaustive and closed: a catalog entry without an implementation (or vice versa) is a compile error. */
export type DoctorCheckRegistry = { readonly [Id in DoctorCheckId]: DoctorCheckDefinition<Id> }
