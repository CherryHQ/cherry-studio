import type {
  FileProcessorFeature,
  FileProcessorId,
  PreferenceDefaultScopeType,
  PreferenceKeyType
} from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'

export interface FileProcessingPreferenceReader {
  get<K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] | Promise<PreferenceDefaultScopeType[K]>
}

export interface ResolveProcessorConfigInput {
  feature: FileProcessorFeature
  processorId?: FileProcessorId
}

export async function resolveProcessorConfig(
  _input: ResolveProcessorConfigInput,
  _preferences: FileProcessingPreferenceReader
): Promise<FileProcessorMerged> {
  void _input
  void _preferences
  throw new Error('Not implemented')
}
