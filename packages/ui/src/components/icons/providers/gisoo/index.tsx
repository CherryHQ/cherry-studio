import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GisooAvatar } from './avatar'
import { GisooDark } from './dark'
import { GisooLight } from './light'

const Gisoo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GisooLight {...props} className={className} />
  if (variant === 'dark') return <GisooDark {...props} className={className} />
  return (
    <>
      <GisooLight className={cn('dark:hidden', className)} {...props} />
      <GisooDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GisooIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gisoo, {
  Avatar: GisooAvatar,
  colorPrimary: '#1B1E28'
})

export default GisooIcon
