import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DeepcogitoAvatar } from './avatar'
import { DeepcogitoDark } from './dark'
import { DeepcogitoLight } from './light'

const Deepcogito = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DeepcogitoLight {...props} className={className} />
  if (variant === 'dark') return <DeepcogitoDark {...props} className={className} />
  return (
    <>
      <DeepcogitoLight className={cn('dark:hidden', className)} {...props} />
      <DeepcogitoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DeepcogitoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepcogito, {
  Avatar: DeepcogitoAvatar,
  colorPrimary: '#4E81EE'
})

export default DeepcogitoIcon
