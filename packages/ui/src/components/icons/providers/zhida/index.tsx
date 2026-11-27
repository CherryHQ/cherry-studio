import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZhidaAvatar } from './avatar'
import { ZhidaDark } from './dark'
import { ZhidaLight } from './light'

const Zhida = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZhidaLight {...props} className={className} />
  if (variant === 'dark') return <ZhidaDark {...props} className={className} />
  return (
    <>
      <ZhidaLight className={cn('dark:hidden', className)} {...props} />
      <ZhidaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ZhidaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zhida, {
  Avatar: ZhidaAvatar,
  colorPrimary: '#000000'
})

export default ZhidaIcon
