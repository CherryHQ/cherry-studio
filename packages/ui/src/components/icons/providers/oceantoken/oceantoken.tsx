import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OceantokenAvatar } from './avatar'
import { OceantokenDark } from './dark'
import { OceantokenLight } from './light'

const Oceantoken = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OceantokenLight {...props} className={className} />
  if (variant === 'dark') return <OceantokenDark {...props} className={className} />
  return (
    <>
      <OceantokenLight className={cn('dark:hidden', className)} {...props} />
      <OceantokenDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const OceantokenIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Oceantoken, {
  Avatar: OceantokenAvatar,
  colorPrimary: '#000000'
})

export default OceantokenIcon
