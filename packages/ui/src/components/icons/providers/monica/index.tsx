import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MonicaAvatar } from './avatar'
import { MonicaDark } from './dark'
import { MonicaLight } from './light'

const Monica = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MonicaLight {...props} className={className} />
  if (variant === 'dark') return <MonicaDark {...props} className={className} />
  return (
    <>
      <MonicaLight className={cn('dark:hidden', className)} {...props} />
      <MonicaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MonicaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Monica, {
  Avatar: MonicaAvatar,
  colorPrimary: '#1E1E1E'
})

export default MonicaIcon
