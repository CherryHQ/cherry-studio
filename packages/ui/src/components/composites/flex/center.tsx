import { Flex, type FlexProps } from './flex'

export interface CenterProps extends Omit<FlexProps, 'direction' | 'align' | 'justify'> {}

/**
 * Centers children on both axes (`items-center justify-center`). Pass `inline`
 * for a centered inline-flex chip; sizing/radius stay in `className`.
 */
export function Center({ gap, inline, ...props }: CenterProps) {
  return <Flex data-slot="center" align="center" justify="center" gap={gap} inline={inline} {...props} />
}
