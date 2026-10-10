import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { IdeogramAvatar } from './avatar'
import { IdeogramDark } from './dark'
import { IdeogramLight } from './light'

const Ideogram = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <IdeogramLight {...props} className={className} />
  if (variant === 'dark') return <IdeogramDark {...props} className={className} />
  return (
    <>
      <IdeogramLight className={cn('dark:hidden', className)} {...props} />
      <IdeogramDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const IdeogramIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ideogram, {
  Avatar: IdeogramAvatar,
  colorPrimary: '#000000'
})

export default IdeogramIcon
