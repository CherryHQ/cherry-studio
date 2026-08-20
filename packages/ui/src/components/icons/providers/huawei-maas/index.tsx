import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HuaweiMaasAvatar } from './avatar'
import { HuaweiMaasDark } from './dark'
import { HuaweiMaasLight } from './light'

const HuaweiMaas = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HuaweiMaasLight {...props} className={className} />
  if (variant === 'dark') return <HuaweiMaasDark {...props} className={className} />
  return (
    <>
      <HuaweiMaasLight className={cn('dark:hidden', className)} {...props} />
      <HuaweiMaasDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HuaweiMaasIcon: CompoundIcon = /*#__PURE__*/ Object.assign(HuaweiMaas, {
  Avatar: HuaweiMaasAvatar,
  colorPrimary: '#C7000B'
})

export default HuaweiMaasIcon
