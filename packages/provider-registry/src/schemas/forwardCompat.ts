/**
 * Forward compatibility for the wire contract — a catalog emitted by a NEWER
 * generator must stay readable by THIS client.
 *
 * `z.object` already strips unknown keys, so additive fields were always safe.
 * The remaining break was vocabulary growth: one unknown member of a closed
 * `z.enum` failed its whole document, which is why every new effort/capability
 * used to force a {@link REGISTRY_SCHEMA_VERSION} bump. {@link looseArray}
 * degrades that failure to the smallest unit that can be dropped:
 *
 *  - inside a list of enum values → drop the unknown member, keep the entry
 *  - inside a list of entries (models/providers/overrides) → drop the entry
 *    the client cannot represent, keep the rest of the catalog
 *
 * Values this client cannot *execute* (a new adapter family, endpoint type,
 * wire behavior) are still gated — by `REGISTRY_MIN_APP_VERSION`, not by
 * parse failure.
 */
import * as z from 'zod'

/**
 * Like `z.array(item)`, but silently drops members that fail to parse.
 *
 * @param min Minimum members required AFTER dropping — the entry is rejected
 * (and dropped by its own enclosing `looseArray`) when too few survive.
 */
export function looseArray<T extends z.ZodType>(item: T, { min }: { min?: number } = {}): z.ZodType<z.output<T>[]> {
  const array = z.array(z.unknown()).transform((values) =>
    values.reduce<z.output<T>[]>((kept, value) => {
      const parsed = item.safeParse(value)
      if (parsed.success) kept.push(parsed.data)
      return kept
    }, [])
  )
  return min === undefined
    ? array
    : array.refine((values) => values.length >= min, { message: `expected at least ${min} recognized value(s)` })
}
