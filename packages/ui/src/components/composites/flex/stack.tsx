import { Flex, type FlexProps } from './flex'

export interface StackProps extends FlexProps {}
export interface VStackProps extends Omit<FlexProps, 'direction'> {}
export interface HStackProps extends Omit<FlexProps, 'direction'> {}

/**
 * Direction-configurable gap-aware stack. Defaults to a vertical column with
 * `gap={2}`. Prefer the fixed-direction `VStack`/`HStack` when the axis is known.
 */
export function Stack({ direction = 'col', gap = 2, ...props }: StackProps) {
  return <Flex data-slot="stack" direction={direction} gap={gap} {...props} />
}

/**
 * Vertical stack — the single canonical replacement for `flex flex-col gap-N`,
 * `space-y-N`, and `gap-[var(--space-stack-*)]`. Defaults `align="stretch"`.
 */
export function VStack({ gap = 2, align = 'stretch', ...props }: VStackProps) {
  return <Flex data-slot="vstack" direction="col" align={align} gap={gap} {...props} />
}

/**
 * Horizontal stack — the canonical replacement for `flex items-center gap-N`
 * rows. Defaults `align="center"`.
 */
export function HStack({ gap = 2, align = 'center', ...props }: HStackProps) {
  return <Flex data-slot="hstack" direction="row" align={align} gap={gap} {...props} />
}
