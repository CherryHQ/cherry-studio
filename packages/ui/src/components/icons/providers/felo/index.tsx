import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FeloAvatar } from './avatar'
import { FeloDark } from './dark'
import { FeloLight } from './light'

const Felo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FeloLight {...props} className={className} />
  if (variant === 'dark') return <FeloDark {...props} className={className} />
  return (
    <>
      <FeloLight className={cn('dark:hidden', className)} {...props} />
      <FeloDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const FeloIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Felo, {
  Avatar: FeloAvatar,
  colorPrimary: '#000000'
})

export default FeloIcon
