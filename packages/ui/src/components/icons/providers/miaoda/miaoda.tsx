import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MiaodaAvatar } from './avatar'
import { MiaodaDark } from './dark'
import { MiaodaLight } from './light'

const Miaoda = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MiaodaLight {...props} className={className} />

  if (variant === 'dark') return <MiaodaDark {...props} className={className} />

  return (
    <>
      <MiaodaLight className={cn('dark:hidden', className)} {...props} />
      <MiaodaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MiaodaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Miaoda, {
  Avatar: MiaodaAvatar,
  colorPrimary: '#000000'
})

export default MiaodaIcon
