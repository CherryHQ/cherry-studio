import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AigatewayAvatar } from './avatar'
import { AigatewayDark } from './dark'
import { AigatewayLight } from './light'

const Aigateway = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AigatewayLight {...props} className={className} />
  if (variant === 'dark') return <AigatewayDark {...props} className={className} />
  return (
    <>
      <AigatewayLight className={cn('dark:hidden', className)} {...props} />
      <AigatewayDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AigatewayIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aigateway, {
  Avatar: AigatewayAvatar,
  colorPrimary: '#fdfcf9'
})

export default AigatewayIcon
