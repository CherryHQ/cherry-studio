import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { McprouterAvatar } from './avatar'
import { McprouterDark } from './dark'
import { McprouterLight } from './light'

const Mcprouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <McprouterLight {...props} className={className} />
  if (variant === 'dark') return <McprouterDark {...props} className={className} />
  return (
    <>
      <McprouterLight className={cn('dark:hidden', className)} {...props} />
      <McprouterDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const McprouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcprouter, {
  Avatar: McprouterAvatar,
  colorPrimary: '#004AAD'
})

export default McprouterIcon
