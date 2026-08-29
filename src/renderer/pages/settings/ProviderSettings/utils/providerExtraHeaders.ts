/**
 * Build an `extraHeaders` merge patch that fully replaces the stored headers.
 *
 * PATCH /providers/:providerId applies `providerSettings` with JSON Merge Patch
 * semantics: keys absent from the patch are kept, so deletions must be expressed
 * as explicit `null` values (see ProviderService.applyJsonMergePatch).
 */
export function buildExtraHeadersReplacementPatch(
  previous: Record<string, string>,
  next: Record<string, string>
): Record<string, string | null> {
  const removed = Object.keys(previous).filter((key) => !Object.hasOwn(next, key))
  return { ...next, ...Object.fromEntries(removed.map((key) => [key, null])) }
}
