import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'
import type { PaintingProviderDefinition } from '../providers/shared/provider'

export function usePaintingPromptPlaceholder(definition: PaintingProviderDefinition, painting: PaintingData): string {
  const { t } = useTranslation()
  const custom = definition.prompt?.placeholder?.({ painting })
  return custom ?? t('paintings.prompt_placeholder')
}
