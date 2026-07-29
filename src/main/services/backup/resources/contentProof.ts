import type { UnitContentRequirement } from './adapters'

/**
 * Prove that a resource payload carries every unit-relative file its database
 * says is required to rebuild derived owner state.
 *
 * `undefined` means the resource kind has no content proof. `null` is an
 * explicitly unsatisfiable proof and therefore never passes.
 */
export function carriesRequiredContent(
  presentPaths: Iterable<string>,
  required: UnitContentRequirement | undefined
): boolean {
  if (required === undefined) return true
  if (required === null) return false
  const present = new Set(presentPaths)
  return required.every((relativePath) => present.has(relativePath))
}
