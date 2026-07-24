import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InflectionAvatar } from './avatar'
import { InflectionDark } from './dark'
import { InflectionLight } from './light'

const Inflection = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InflectionLight {...props} className={className} />
  if (variant === 'dark') return <InflectionDark {...props} className={className} />
  return (
    <>
      <InflectionLight className={cn('dark:hidden', className)} {...props} />
      <InflectionDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const InflectionIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inflection, {
  Avatar: InflectionAvatar,
  colorPrimary: '#000000'
})

export default InflectionIcon
