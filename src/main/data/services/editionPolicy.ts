import { isMigratedFromV1 } from '@data/migration/v1MigrationOrigin'
import { getAppEdition } from '@main/utils/appEdition'
import type { AppEdition } from '@shared/types/appEdition'

/**
 * Edition availability for catalog-backed entities (providers, mini apps).
 *
 * The rule is declared once per entity via {@link defineEditionScope} and reaches
 * the code through the type system rather than through a call convention: a scope
 * is the only producer of an {@link EditionDecision}, and each entity's row → domain
 * mapper takes one as a required argument. An entity this build withholds cannot be
 * materialized, so nothing that surfaces it needs its own check — and a new mapper
 * that forgets the rule does not compile.
 *
 * What belongs here, and what must not:
 *
 * - Only build-time inputs. A runtime signal (detected region, a user setting)
 *   cannot carry a compliance rule: the same artifact would behave differently per
 *   machine, and anything the user can flip is not a restriction. Region-based
 *   curation is a separate, weaker concern and stays where it is.
 * - Nothing is persisted, and nothing is withheld from a write. Editions share one
 *   database — seeders and migrators populate both identically — so an edition must
 *   never cause a row to be written, cleared or skipped. It decides what this build
 *   surfaces, not what the profile contains.
 */
export interface EditionScopedEntry {
  availableInEditions?: readonly AppEdition[]
}

declare const editionScoped: unique symbol

/**
 * Proof that the edition rule was applied to one entity. Produced only by
 * `EditionScope.resolve`; `withheld` produces no value at all, so a caller cannot
 * reach the mapper without handling that case.
 *
 * `unscoped` covers rows that belong to no catalog — a fully custom provider, a
 * user-authored mini app. The edition has no opinion on what the user built.
 */
export type EditionDecision<Entry> = { readonly [editionScoped]: true; entry: Entry } & (
  | { status: 'allowed' }
  | { status: 'unscoped' }
)

export interface EditionScope<Identity, Entry> {
  /** `null` when this build withholds the entity. */
  resolve(identity: Identity): EditionDecision<Entry> | null
}

/**
 * Declare an entity as edition-scoped.
 *

 * `lookup` returns the catalog entry behind a row plus whether the row has a catalog
 * identity at all. An entry that the catalog does not describe is **not** withheld:
 * withholding requires a positive statement in the catalog, because rows are the
 * source of truth and a catalog that dropped an entry — or failed to load — must not
 * silently revoke what a profile is already using.
 */
export function defineEditionScope<Identity, Entry extends EditionScopedEntry>(spec: {
  lookup: (identity: Identity) => { entry: Entry; scoped: boolean }
}): EditionScope<Identity, Entry> {
  return {
    resolve(identity) {
      const { entry, scoped } = spec.lookup(identity)
      if (!scoped) return { status: 'unscoped', entry } as EditionDecision<Entry>
      if (!isAllowedInCurrentEdition(entry)) return null
      return { status: 'allowed', entry } as EditionDecision<Entry>
    }
  }
}

/**
 * Whether the running build offers this catalog entry.
 *
 * A profile upgraded from v1 is exempt wholesale: its entities predate the edition
 * split. Reading the exemption here keeps it at the single seam instead of leaking
 * into every consumer.
 */
export function isAllowedInCurrentEdition(entry: EditionScopedEntry): boolean {
  if (isMigratedFromV1()) return true
  return !entry.availableInEditions || entry.availableInEditions.includes(getAppEdition())
}
