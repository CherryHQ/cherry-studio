import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MetasoAvatar } from './avatar'
import { MetasoDark } from './dark'
import { MetasoLight } from './light'

const Metaso = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MetasoLight {...props} className={className} />
  if (variant === 'dark') return <MetasoDark {...props} className={className} />
  return (
    <>
      <MetasoLight className={cn('dark:hidden', className)} {...props} />
      <MetasoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MetasoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Metaso, {
  Avatar: MetasoAvatar,
  colorPrimary: '#175CD3'
})

export default MetasoIcon
