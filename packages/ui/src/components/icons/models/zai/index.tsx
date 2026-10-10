import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZaiAvatar } from './avatar'
import { ZaiDark } from './dark'
import { ZaiLight } from './light'

const Zai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZaiLight {...props} className={className} />
  if (variant === 'dark') return <ZaiDark {...props} className={className} />
  return (
    <>
      <ZaiLight className={cn('dark:hidden', className)} {...props} />
      <ZaiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ZaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zai, {
  Avatar: ZaiAvatar,
  colorPrimary: '#000000'
})

export default ZaiIcon
