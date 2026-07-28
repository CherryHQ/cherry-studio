import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { VoyageAvatar } from './avatar'
import { VoyageDark } from './dark'
import { VoyageLight } from './light'

const Voyage = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <VoyageLight {...props} className={className} />
  if (variant === 'dark') return <VoyageDark {...props} className={className} />
  return (
    <>
      <VoyageLight className={cn('dark:hidden', className)} {...props} />
      <VoyageDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const VoyageIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Voyage, {
  Avatar: VoyageAvatar,
  colorPrimary: '#012E33'
})

export default VoyageIcon
