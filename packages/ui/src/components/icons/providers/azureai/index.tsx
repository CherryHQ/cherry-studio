import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AzureaiAvatar } from './avatar'
import { AzureaiLight } from './light'

const Azureai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AzureaiLight {...props} className={className} />
  return <AzureaiLight {...props} className={className} />
}

export const AzureaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Azureai, {
  Avatar: AzureaiAvatar,
  colorPrimary: '#000000'
})

export default AzureaiIcon
