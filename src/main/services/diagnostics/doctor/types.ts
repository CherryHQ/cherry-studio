import type {
  DoctorCheckId,
  DoctorCheckOutcome,
  DoctorEvidenceItem,
  DoctorFixId,
  DoctorFixTarget,
  DoctorSubject,
  DoctorSubjectFor
} from '@shared/types/doctor'

export interface DoctorContextBase {
  /** Aborted on the check's timeout or when the whole run is canceled; long probes should honour it. */
  readonly signal: AbortSignal
  /** Memoizes `factory` under `key` for the current run, so checks in different layers reuse one probe. */
  share<T>(key: string, factory: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/** What the engine builds: the run's facts, or `null` for a global run. */
export interface DoctorContext extends DoctorContextBase {
  readonly subject: DoctorSubject | null
}

/** Checks that read no facts (`scope: 'global' | 'any'`) get no `subject` to read. */
type DoctorSubjectSlot<Id extends DoctorCheckId> =
  DoctorSubjectFor<Id> extends undefined ? { readonly subject?: undefined } : { readonly subject: DoctorSubjectFor<Id> }

/** What a check's `run` sees: `subject` narrowed to the facts its catalog `scope` declared. */
export type DoctorCheckContext<Id extends DoctorCheckId> = DoctorContextBase & DoctorSubjectSlot<Id>

export type DoctorProbeOutcome<Id extends DoctorCheckId> = DoctorCheckOutcome<Id> & {
  readonly devMessage?: string
  readonly evidence?: readonly DoctorEvidenceItem[]
}

export type DoctorFixOutcome =
  | { readonly status: 'fixed' | 'requires_relaunch' }
  | { readonly status: 'failed'; readonly message: string }

export type DoctorFixContext<Id extends DoctorCheckId, Fix extends DoctorFixId<Id>> = DoctorContextBase &
  DoctorFixTarget<Id, Fix>

export type DoctorFixHandler<Id extends DoctorCheckId, Fix extends DoctorFixId<Id>> = (
  ctx: DoctorFixContext<Id, Fix>
) => Promise<DoctorFixOutcome>

/** A check implementation. Domain, tier, scope, prerequisites and fix metadata live in the shared catalog. */
export interface DoctorCheckDefinition<Id extends DoctorCheckId> {
  readonly id: Id
  /** Overrides the tier default (quick 1s, live 15s, deep 60s). */
  readonly timeoutMs?: number
  run(ctx: DoctorCheckContext<Id>): Promise<DoctorProbeOutcome<Id>>
  /** One handler per fix the catalog declares; `{}` when it declares none. */
  readonly fixes: { readonly [Fix in DoctorFixId<Id>]: DoctorFixHandler<Id, Fix> }
}

/** The engine's view of a check; the per-check `subject` narrowing is widened once at this boundary. */
export interface DoctorEngineDefinition {
  readonly timeoutMs?: number
  run(ctx: DoctorContext): Promise<DoctorProbeOutcome<DoctorCheckId>>
}

export const defineDoctorCheck = <Id extends DoctorCheckId>(def: DoctorCheckDefinition<Id>) => def

/** Exhaustive and closed: a catalog entry without an implementation (or vice versa) is a compile error. */
export type DoctorCheckRegistry = { readonly [Id in DoctorCheckId]: DoctorCheckDefinition<Id> }
