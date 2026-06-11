import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RecraftAvatar } from './avatar'
import { RecraftDark } from './dark'
import { RecraftLight } from './light'

const Recraft = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RecraftLight {...props} className={className} />
  if (variant === 'dark') return <RecraftDark {...props} className={className} />
  return (
    <>
      <RecraftLight className={cn(className, 'dark:hidden')} {...props} />
      <RecraftDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const RecraftIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Recraft, {
  Avatar: RecraftAvatar,
  colorPrimary: '#010101'
})

export default RecraftIcon
