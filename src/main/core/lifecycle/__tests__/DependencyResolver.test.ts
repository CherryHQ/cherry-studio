import { describe, expect, it } from 'vitest'

import { CircularDependencyError, DependencyResolver } from '../DependencyResolver'
import type { DependencyNode } from '../types'
import { Phase } from '../types'

/** Create a DependencyNode with sensible defaults */
function createDependencyNode(overrides: Partial<DependencyNode> & { name: string }): DependencyNode {
  return {
    dependencies: [],
    priority: 100,
    phase: Phase.WhenReady,
    ...overrides
  }
}

describe('DependencyResolver', () => {
  const resolver = new DependencyResolver()

  describe('resolve (topological sort)', () => {
    it('should return empty array for no nodes', () => {
      expect(resolver.resolve([])).toEqual([])
    })

    it('should return single node', () => {
      const nodes = [createDependencyNode({ name: 'A' })]
      expect(resolver.resolve(nodes)).toEqual(['A'])
    })

    it('should resolve linear dependency chain', () => {
      const nodes = [
        createDependencyNode({ name: 'C', dependencies: ['B'] }),
        createDependencyNode({ name: 'B', dependencies: ['A'] }),
        createDependencyNode({ name: 'A' })
      ]

      const order = resolver.resolve(nodes)
      expect(order).toEqual(['A', 'B', 'C'])
    })

    it('should resolve diamond dependency', () => {
      // A <- B, A <- C, B <- D, C <- D
      const nodes = [
        createDependencyNode({ name: 'A' }),
        createDependencyNode({ name: 'B', dependencies: ['A'] }),
        createDependencyNode({ name: 'C', dependencies: ['A'] }),
        createDependencyNode({ name: 'D', dependencies: ['B', 'C'] })
      ]

      const order = resolver.resolve(nodes)

      // A must come before B and C, both must come before D
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'))
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'))
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'))
      expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'))
    })

    it('should respect priority for nodes at the same level', () => {
      const nodes = [
        createDependencyNode({ name: 'Low', priority: 200 }),
        createDependencyNode({ name: 'High', priority: 10 }),
        createDependencyNode({ name: 'Mid', priority: 100 })
      ]

      const order = resolver.resolve(nodes)
      expect(order).toEqual(['High', 'Mid', 'Low'])
    })

    it('should throw CircularDependencyError for direct cycle', () => {
      const nodes = [
        createDependencyNode({ name: 'A', dependencies: ['B'] }),
        createDependencyNode({ name: 'B', dependencies: ['A'] })
      ]

      expect(() => resolver.resolve(nodes)).toThrow(CircularDependencyError)
    })

    it('should throw CircularDependencyError for indirect cycle', () => {
      const nodes = [
        createDependencyNode({ name: 'A', dependencies: ['C'] }),
        createDependencyNode({ name: 'B', dependencies: ['A'] }),
        createDependencyNode({ name: 'C', dependencies: ['B'] })
      ]

      expect(() => resolver.resolve(nodes)).toThrow(CircularDependencyError)
    })

    it('should include cycle path in error', () => {
      const nodes = [
        createDependencyNode({ name: 'A', dependencies: ['B'] }),
        createDependencyNode({ name: 'B', dependencies: ['A'] })
      ]

      try {
        resolver.resolve(nodes)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(CircularDependencyError)
        const cycleError = error as CircularDependencyError
        expect(cycleError.cycle).toContain('A')
        expect(cycleError.cycle).toContain('B')
      }
    })

    it('should ignore unknown dependencies gracefully', () => {
      const nodes = [
        createDependencyNode({ name: 'A', dependencies: ['Unknown'] }),
        createDependencyNode({ name: 'B' })
      ]

      // Unknown deps are skipped in the graph building
      const order = resolver.resolve(nodes)
      expect(order).toHaveLength(2)
      expect(order).toContain('A')
      expect(order).toContain('B')
    })
  })

  describe('resolveLayered (parallel execution layers)', () => {
    it('should return empty layers for no nodes', () => {
      expect(resolver.resolveLayered([])).toEqual([])
    })

    it('should group independent nodes into one layer', () => {
      const nodes = [
        createDependencyNode({ name: 'A' }),
        createDependencyNode({ name: 'B' }),
        createDependencyNode({ name: 'C' })
      ]

      const layers = resolver.resolveLayered(nodes)
      expect(layers).toHaveLength(1)
      expect(layers[0]).toHaveLength(3)
    })

    it('should separate dependent nodes into sequential layers', () => {
      const nodes = [
        createDependencyNode({ name: 'A' }),
        createDependencyNode({ name: 'B', dependencies: ['A'] }),
        createDependencyNode({ name: 'C', dependencies: ['B'] })
      ]

      const layers = resolver.resolveLayered(nodes)
      expect(layers).toEqual([['A'], ['B'], ['C']])
    })

    it('should group siblings in the same layer', () => {
      const nodes = [
        createDependencyNode({ name: 'Root' }),
        createDependencyNode({ name: 'Child1', dependencies: ['Root'] }),
        createDependencyNode({ name: 'Child2', dependencies: ['Root'] })
      ]

      const layers = resolver.resolveLayered(nodes)
      expect(layers).toHaveLength(2)
      expect(layers[0]).toEqual(['Root'])
      expect(layers[1]).toContain('Child1')
      expect(layers[1]).toContain('Child2')
    })

    it('should throw CircularDependencyError for cycles', () => {
      const nodes = [
        createDependencyNode({ name: 'A', dependencies: ['B'] }),
        createDependencyNode({ name: 'B', dependencies: ['A'] })
      ]

      expect(() => resolver.resolveLayered(nodes)).toThrow(CircularDependencyError)
    })
  })

  describe('validateAndAdjustPhases', () => {
    it('should return no adjustments for valid phase dependencies', () => {
      const nodes = [
        createDependencyNode({ name: 'A', phase: Phase.BeforeReady }),
        createDependencyNode({ name: 'B', phase: Phase.WhenReady, dependencies: ['A'] })
      ]

      const adjustments = resolver.validateAndAdjustPhases(nodes)
      expect(adjustments).toHaveLength(0)
    })

    it('should adjust BeforeReady service depending on WhenReady service', () => {
      const nodes = [
        createDependencyNode({ name: 'Early', phase: Phase.BeforeReady, dependencies: ['Late'] }),
        createDependencyNode({ name: 'Late', phase: Phase.WhenReady })
      ]

      const adjustments = resolver.validateAndAdjustPhases(nodes)
      expect(adjustments).toHaveLength(1)
      expect(adjustments[0].serviceName).toBe('Early')
      expect(adjustments[0].originalPhase).toBe(Phase.BeforeReady)
      expect(adjustments[0].adjustedPhase).toBe(Phase.WhenReady)
    })

    it('should mutate the input nodes with adjusted phases', () => {
      const nodes = [
        createDependencyNode({ name: 'Early', phase: Phase.BeforeReady, dependencies: ['Late'] }),
        createDependencyNode({ name: 'Late', phase: Phase.WhenReady })
      ]

      resolver.validateAndAdjustPhases(nodes)
      expect(nodes[0].phase).toBe(Phase.WhenReady)
    })
  })

  describe('getDependents', () => {
    it('should find direct dependents', () => {
      const nodes = [
        createDependencyNode({ name: 'A' }),
        createDependencyNode({ name: 'B', dependencies: ['A'] }),
        createDependencyNode({ name: 'C', dependencies: ['A'] }),
        createDependencyNode({ name: 'D' })
      ]

      const dependents = resolver.getDependents('A', nodes)
      expect(dependents).toContain('B')
      expect(dependents).toContain('C')
      expect(dependents).not.toContain('D')
    })

    it('should find transitive dependents', () => {
      const nodes = [
        createDependencyNode({ name: 'A' }),
        createDependencyNode({ name: 'B', dependencies: ['A'] }),
        createDependencyNode({ name: 'C', dependencies: ['B'] })
      ]

      const dependents = resolver.getDependents('A', nodes)
      expect(dependents).toContain('B')
      expect(dependents).toContain('C')
    })

    it('should return empty for leaf nodes', () => {
      const nodes = [createDependencyNode({ name: 'A' }), createDependencyNode({ name: 'B', dependencies: ['A'] })]

      expect(resolver.getDependents('B', nodes)).toEqual([])
    })
  })

  describe('getDependencies', () => {
    it('should find direct dependencies', () => {
      const nodes = [
        createDependencyNode({ name: 'A' }),
        createDependencyNode({ name: 'B' }),
        createDependencyNode({ name: 'C', dependencies: ['A', 'B'] })
      ]

      const deps = resolver.getDependencies('C', nodes)
      expect(deps).toContain('A')
      expect(deps).toContain('B')
    })

    it('should find transitive dependencies', () => {
      const nodes = [
        createDependencyNode({ name: 'A' }),
        createDependencyNode({ name: 'B', dependencies: ['A'] }),
        createDependencyNode({ name: 'C', dependencies: ['B'] })
      ]

      const deps = resolver.getDependencies('C', nodes)
      expect(deps).toContain('A')
      expect(deps).toContain('B')
    })

    it('should return empty for root nodes', () => {
      const nodes = [createDependencyNode({ name: 'A' }), createDependencyNode({ name: 'B', dependencies: ['A'] })]

      expect(resolver.getDependencies('A', nodes)).toEqual([])
    })
  })
})
