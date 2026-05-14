import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AzureaiAvatar } from './avatar'
import { AzureaiDark } from './dark'
import { AzureaiLight } from './light'

const Azureai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AzureaiLight {...props} className={className} />
  if (variant === 'dark') return <AzureaiDark {...props} className={className} />
  return (
    <>
      <AzureaiLight className={cn('dark:hidden', className)} {...props} />
      <AzureaiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AzureaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Azureai, {
  Avatar: AzureaiAvatar,
  colorPrimary: '#000000'
})

export default AzureaiIcon
