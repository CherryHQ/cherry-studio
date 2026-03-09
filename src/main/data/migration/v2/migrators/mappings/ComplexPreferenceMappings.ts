/**
 * Complex Preference Mappings
 *
 * This module defines complex preference transformations that cannot be handled
 * by simple one-to-one mappings. It supports:
 *
 * 1. Object splitting (1→N): One source object splits into multiple preference keys
 * 2. Multi-source merging (N→1): Multiple sources merge into one or more targets
 * 3. Value calculation/transformation: Values need computation or format conversion
 * 4. Conditional mapping: Target keys determined by source values
 *
 * Usage:
 * 1. Define transformation function in PreferenceTransformers.ts
 * 2. Add mapping configuration to COMPLEX_PREFERENCE_MAPPINGS below
 * 3. Add target key definitions in target-key-definitions.json
 *
 * IMPORTANT: Ensure no conflicts between simple mappings and complex mappings.
 * The system uses strict mode - conflicts will cause errors at runtime.
 */

import { transformCodeToolsToOverrides } from './CodeToolsTransforms'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Source definition for reading data from original storage
 */
export interface SourceDefinition {
  /** Data source type */
  source: 'electronStore' | 'redux'
  /** Key path to read from source */
  key: string
  /** Redux category (required for redux source) */
  category?: string
}

/**
 * Transform result type - maps target keys to their values
 */
export type TransformResult = Record<string, unknown>

/**
 * Transform function signature
 * @param sources - Collected source values keyed by source name
 * @returns Record of targetKey -> value pairs
 */
export type TransformFunction = (sources: Record<string, unknown>) => TransformResult

/**
 * Complex mapping definition
 */
export interface ComplexMapping {
  /** Unique identifier for this mapping (used for error reporting and tracking) */
  id: string
  /** Human-readable description of what this mapping does */
  description: string
  /** Source data definitions - key is the name used in transform function */
  sources: Record<string, SourceDefinition>
  /** Target preference keys that this mapping produces (for validation) */
  targetKeys: string[]
  /** Transformation function that converts sources to target values */
  transform: TransformFunction
}

// ============================================================================
// Complex Mappings Configuration
// ============================================================================

/**
 * All complex preference mappings
 *
 * Add new complex mappings here. Each mapping must:
 * 1. Have a unique id
 * 2. Define all source data it needs
 * 3. List all target keys it produces
 * 4. Provide a transformation function
 *
 * Remember to also define the target keys in target-key-definitions.json!
 */
export const COMPLEX_PREFERENCE_MAPPINGS: ComplexMapping[] = [
  {
    id: 'code_tools_overrides',
    description: 'Merge codeTools per-tool data (models, env vars, directories) into layered preset overrides',
    sources: {
      selectedModels: { source: 'redux', category: 'codeTools', key: 'selectedModels' },
      environmentVariables: { source: 'redux', category: 'codeTools', key: 'environmentVariables' },
      directories: { source: 'redux', category: 'codeTools', key: 'directories' },
      currentDirectory: { source: 'redux', category: 'codeTools', key: 'currentDirectory' },
      selectedCliTool: { source: 'redux', category: 'codeTools', key: 'selectedCliTool' }
    },
    targetKeys: ['feature.code_tools.overrides'],
    transform: (sources) => {
      const overrides = transformCodeToolsToOverrides({
        selectedModels: sources.selectedModels as Record<string, unknown> | null,
        environmentVariables: sources.environmentVariables as Record<string, string> | null,
        directories: sources.directories as string[] | null,
        currentDirectory: sources.currentDirectory as string | null,
        selectedCliTool: sources.selectedCliTool as string | null
      })
      return { 'feature.code_tools.overrides': overrides }
    }
  }
]

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get all target keys from complex mappings (for conflict detection)
 */
export function getComplexMappingTargetKeys(): string[] {
  return COMPLEX_PREFERENCE_MAPPINGS.flatMap((m) => m.targetKeys)
}

/**
 * Get complex mapping by id
 */
export function getComplexMappingById(id: string): ComplexMapping | undefined {
  return COMPLEX_PREFERENCE_MAPPINGS.find((m) => m.id === id)
}
