import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MineruAvatar } from './avatar'
import { MineruDark } from './dark'
import { MineruLight } from './light'

const Mineru = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MineruLight {...props} className={className} />
  if (variant === 'dark') return <MineruDark {...props} className={className} />
  return (
    <>
      <MineruLight className={cn(className, 'dark:hidden')} {...props} />
      <MineruDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const MineruIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mineru, {
  Avatar: MineruAvatar,
  colorPrimary: '#000000'
})

export default MineruIcon
