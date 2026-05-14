import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LeptonAvatar } from './avatar'
import { LeptonDark } from './dark'
import { LeptonLight } from './light'

const Lepton = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LeptonLight {...props} className={className} />
  if (variant === 'dark') return <LeptonDark {...props} className={className} />
  return (
    <>
      <LeptonLight className={cn('dark:hidden', className)} {...props} />
      <LeptonDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LeptonIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lepton, {
  Avatar: LeptonAvatar,
  colorPrimary: '#2D9CDB'
})

export default LeptonIcon
