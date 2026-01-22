import type { FileProcessorMerged } from '@renderer/hooks/useFileProcessors'
import type { FileProcessorUserConfig } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import BuiltinProcessorSettingsContent from './BuiltinProcessorSettingsContent'

interface BuiltinProcessorSettingsProps {
  processor: FileProcessorMerged
  updateConfig: (update: Partial<Omit<FileProcessorUserConfig, 'id'>>) => void
}

const BuiltinProcessorSettings: FC<BuiltinProcessorSettingsProps> = ({ processor, updateConfig }) => {
  const { t } = useTranslation()

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="px-4 py-2">{t(`processor.${processor.id}.name`)}</div>
      <div className="border-border border-b" />
      <BuiltinProcessorSettingsContent processor={processor} updateConfig={updateConfig} />
    </div>
  )
}

export default BuiltinProcessorSettings
