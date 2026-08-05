import { portableCollisionKey, toRelativeSegments } from '@main/utils/relativePath'

interface CoverageNode<T> {
  readonly children: Map<string, CoverageNode<T>>
  unit?: { readonly value: T; readonly isDirectory: boolean }
}

export interface ResourceCoverageDescriptor {
  readonly path: string
  readonly isDirectory: boolean
}

export interface ResourceCoverageConflict<T> {
  readonly kind: 'duplicate' | 'overlap'
  readonly existing: T
  readonly incoming: T
}

export type ResourceCoverageIndexBuild<T> =
  | { readonly ok: true; readonly index: ResourceCoverageIndex<T> }
  | { readonly ok: false; readonly conflict: ResourceCoverageConflict<T> }

function node<T>(): CoverageNode<T> {
  return { children: new Map() }
}

function segmentsOf(relativePath: string): readonly string[] {
  return toRelativeSegments(portableCollisionKey(relativePath))
}

function firstUnit<T>(root: CoverageNode<T>): T | null {
  if (root.unit) return root.unit.value
  for (const child of root.children.values()) {
    const found = firstUnit(child)
    if (found !== null) return found
  }
  return null
}

/**
 * Prefix index for the resource payload authority set.
 *
 * Producer and admission both need exact coverage checks at the 50k-unit
 * ceiling. Walking this trie makes each lookup proportional to path depth rather
 * than rescanning every declared unit for every archive entry.
 */
export class ResourceCoverageIndex<T> {
  private readonly root = node<T>()

  private add(value: T, descriptor: ResourceCoverageDescriptor): ResourceCoverageConflict<T> | null {
    const segments = segmentsOf(descriptor.path)
    let current = this.root
    for (const segment of segments) {
      if (current.unit) {
        return { kind: 'overlap', existing: current.unit.value, incoming: value }
      }
      let child = current.children.get(segment)
      if (!child) {
        child = node<T>()
        current.children.set(segment, child)
      }
      current = child
    }

    if (current.unit) {
      return { kind: 'duplicate', existing: current.unit.value, incoming: value }
    }
    const descendant = firstUnit(current)
    if (descendant !== null) {
      return { kind: 'overlap', existing: descendant, incoming: value }
    }
    current.unit = { value, isDirectory: descriptor.isDirectory }
    return null
  }

  /** The one file/directory unit that owns `relativePath`, or null when undeclared. */
  public covering(relativePath: string): T | null {
    const segments = segmentsOf(relativePath)
    let current = this.root
    for (const segment of segments) {
      if (current.unit?.isDirectory) return current.unit.value
      const child = current.children.get(segment)
      if (!child) return null
      current = child
    }
    return current.unit?.value ?? null
  }

  /** Whether a directory is an ancestor of a unit, a unit root, or inside a directory unit. */
  public isStructuralDirectory(relativePath: string): boolean {
    const segments = segmentsOf(relativePath)
    let current = this.root
    for (const segment of segments) {
      if (current.unit?.isDirectory) return true
      const child = current.children.get(segment)
      if (!child) return false
      current = child
    }
    return current.unit !== undefined || current.children.size > 0
  }

  public static build<T>(
    values: readonly T[],
    describe: (value: T) => ResourceCoverageDescriptor
  ): ResourceCoverageIndexBuild<T> {
    const index = new ResourceCoverageIndex<T>()
    for (const value of values) {
      const conflict = index.add(value, describe(value))
      if (conflict) return { ok: false, conflict }
    }
    return { ok: true, index }
  }
}
