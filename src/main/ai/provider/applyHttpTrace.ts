import { application } from '@application'
import type { Model } from '@shared/data/types/model'

import { createHttpTraceFetch } from '../observability'
import type { ProviderConfig } from '../types'
import { customFetch } from '../utils/customFetch'

export function applyHttpTrace(
  config: Pick<ProviderConfig, 'providerSettings'>,
  topicId: string | undefined,
  model: Model
): void {
  if (!application.get('PreferenceService').get('app.developer_mode.enabled')) return
  const settings = config.providerSettings
  settings.fetch = createHttpTraceFetch(settings.fetch ?? customFetch, {
    topicId,
    modelName: model.name ?? model.id
  })
}
