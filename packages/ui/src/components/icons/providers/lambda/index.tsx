import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LambdaAvatar } from './avatar'
import { LambdaDark } from './dark'
import { LambdaLight } from './light'

const Lambda = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LambdaLight {...props} className={className} />
  if (variant === 'dark') return <LambdaDark {...props} className={className} />
  return (
    <>
      <LambdaLight className={cn('dark:hidden', className)} {...props} />
      <LambdaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LambdaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lambda, {
  Avatar: LambdaAvatar,
  colorPrimary: '#000000'
})

export default LambdaIcon
