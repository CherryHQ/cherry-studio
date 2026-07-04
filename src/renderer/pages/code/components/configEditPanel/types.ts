import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig/types'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CodeCli } from '@shared/types/codeCli'

export type ConfigDraftMode = 'managed' | 'foreign'
export type ClaudeModelMode = 'common' | 'detailed'

export interface ConfigDraft {
  modelId: UniqueModelId | undefined
  config: Record<string, unknown>
  files: CliConfigFileDraft[]
  connection: CliConfigConnection | null
  mode: ConfigDraftMode
  error: string
}

export interface ConfigEditPanelSubmitValues {
  modelId?: UniqueModelId
  cliConfigModelId?: UniqueModelId
  config?: Record<string, unknown>
  cliConfigFiles?: CliConfigFileDraft[]
  cliConfigOnly?: boolean
  writePrimaryModel?: boolean
}

export interface ConfigEditPanelProps {
  onClose: () => void
  cliTool: CodeCli
  provider: Provider
  providerConfig: CliProviderConfig | null
  isCurrentProvider: boolean
  modelFilter: (model: Model) => boolean
  onSubmit: (values: ConfigEditPanelSubmitValues) => Promise<void>
}
