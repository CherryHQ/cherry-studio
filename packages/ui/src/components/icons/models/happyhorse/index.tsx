import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HappyhorseAvatar } from './avatar'
import { HappyhorseDark } from './dark'
import { HappyhorseLight } from './light'

const Happyhorse = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HappyhorseLight {...props} className={className} />
  if (variant === 'dark') return <HappyhorseDark {...props} className={className} />
  return (
    <>
      <HappyhorseLight className={cn('dark:hidden', className)} {...props} />
      <HappyhorseDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HappyhorseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Happyhorse, {
  Avatar: HappyhorseAvatar,
  colorPrimary: '#000000'
})

export default HappyhorseIcon
