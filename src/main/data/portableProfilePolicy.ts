/**
 * Shared structural contracts for owner-provided portable profile policy.
 *
 * The data layer owns only these shapes. Each business owner defines the
 * trusted patch, diagnostic field union, runtime schema, and fallback behavior
 * for its own data.
 */
export interface PortableProfileSanitization<TPatch extends object, TMalformedField extends string> {
  readonly patch: Readonly<TPatch>
  readonly malformedFields: readonly TMalformedField[]
}

/** JSON value accepted by the durable restore journal. */
export type PortableProfileJsonValue =
  | string
  | number
  | boolean
  | null
  | PortableProfileJsonValue[]
  | { [key: string]: PortableProfileJsonValue }

/** Opaque JSON object transported by the restore journal. */
export interface RestoreOwnerSummaryBag {
  readonly [owner: string]: PortableProfileJsonValue
}

/** Common result of interpreting one owner's entry in the opaque journal bag. */
export type RestoreOwnerSummaryReadResult<TSummary> =
  | { readonly kind: 'ok'; readonly summary: TSummary }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }

/** Opaque per-owner progress transported by the restore journal. */
export interface RestoreOwnerProgressBag {
  readonly [owner: string]: PortableProfileJsonValue
}

/** Common result of interpreting one owner's progress entry. */
export type RestoreOwnerProgressReadResult<TProgress> =
  | { readonly kind: 'ok'; readonly progress: TProgress }
  | { readonly kind: 'invalid' }
