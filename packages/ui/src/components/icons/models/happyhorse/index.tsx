import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HappyhorseAvatar } from './avatar'
import { HappyhorseDark } from './dark'
import { HappyhorseLight } from './light'

const Happyhorse = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HappyhorseLight {...props} className={cn('text-foreground', className)} />
  if (variant === 'dark') return <HappyhorseDark {...props} className={cn('text-foreground', className)} />
  return (
    <>
      <HappyhorseLight className={cn('text-foreground dark:hidden', className)} {...props} />
      <HappyhorseDark className={cn('text-foreground hidden dark:block', className)} {...props} />
    </>
  )
}

export const HappyhorseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Happyhorse, {
  Avatar: HappyhorseAvatar,
  colorPrimary: '#000000'
})

export default HappyhorseIcon
