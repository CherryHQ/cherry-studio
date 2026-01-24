/**
 * File Processing Configuration
 *
 * Templates live in shared presets and are re-exported here for renderer usage.
 * User configurations (apiKey, featureConfigs, etc.) are stored in Preference system.
 */

import {
  type FeatureCapability,
  type FileProcessorFeature,
  type FileProcessorInput,
  type FileProcessorTemplate,
  PRESETS_FILE_PROCESSORS
} from '@shared/data/presets/fileProcessing'

export type {
  FeatureCapability,
  FileProcessorFeature,
  FileProcessorInput,
  FileProcessorMetadata,
  FileProcessorOutput,
  FileProcessorTemplate,
  FileProcessorType
} from '@shared/data/presets/fileProcessing'
export { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'

/**
 * Local alias kept for backward compatibility in renderer code.
 */
export const FILE_PROCESSOR_TEMPLATES: FileProcessorTemplate[] = PRESETS_FILE_PROCESSORS

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get processor template by ID
 */
export function getFileProcessorTemplate(id: string): FileProcessorTemplate | undefined {
  return FILE_PROCESSOR_TEMPLATES.find((t) => t.id === id)
}

/**
 * Get all image processors (have capability with input='image')
 */
export function getImageProcessorTemplates(): FileProcessorTemplate[] {
  return FILE_PROCESSOR_TEMPLATES.filter((t) => t.capabilities.some((c) => c.input === 'image'))
}

/**
 * Get all document processors (have capability with input='document')
 */
export function getDocumentProcessorTemplates(): FileProcessorTemplate[] {
  return FILE_PROCESSOR_TEMPLATES.filter((t) => t.capabilities.some((c) => c.input === 'document'))
}

/**
 * Check if processor supports a specific input type
 */
export function supportsInput(processor: FileProcessorTemplate, input: FileProcessorInput): boolean {
  return processor.capabilities.some((c) => c.input === input)
}

/**
 * Check if processor supports a specific feature
 */
export function supportsFeature(processor: FileProcessorTemplate, feature: FileProcessorFeature): boolean {
  return processor.capabilities.some((c) => c.feature === feature)
}

/**
 * Get capability for a specific feature and input combination
 */
export function getCapability(
  processor: FileProcessorTemplate,
  feature: FileProcessorFeature,
  input: FileProcessorInput
): FeatureCapability | undefined {
  return processor.capabilities.find((c) => c.feature === feature && c.input === input)
}
