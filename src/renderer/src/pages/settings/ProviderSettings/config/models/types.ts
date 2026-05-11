import type { Model } from '@shared/data/types/model'

export type ProviderSettingsLogoModel = Pick<Model, 'id' | 'name' | 'providerId'>

export type ProviderSettingsGroupModel = Pick<Model, 'id'> & Partial<Pick<Model, 'group'>>

export type ProviderSettingsDisplayModel = Pick<
  Model,
  'id' | 'name' | 'providerId' | 'capabilities' | 'endpointTypes'
> &
  Partial<Pick<Model, 'description' | 'group'>>
