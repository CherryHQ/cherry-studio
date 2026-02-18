import type { CompoundIcon } from '../../types'
import { AzureaiAvatar } from './avatar'
import { Azureai } from './color'
import { AzureaiMono } from './mono'

export const AzureaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Azureai, {
  Color: Azureai,
  Mono: AzureaiMono,
  Avatar: AzureaiAvatar,
  colorPrimary: '#000000'
})
export default AzureaiIcon
