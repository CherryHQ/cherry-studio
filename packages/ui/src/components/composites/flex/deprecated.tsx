import { Flex, type FlexProps } from './flex'

/**
 * @deprecated Use `HStack` (vertically-centered row) or `Flex direction="row"`.
 * Kept as a back-compat wrapper that now also accepts the `gap`/`align`/`justify`
 * props. Slated for removal once call sites migrate.
 */
export function RowFlex(props: Omit<FlexProps, 'direction'>) {
  return <Flex data-slot="row-flex" direction="row" {...props} />
}

/**
 * @deprecated Use `VStack` or `Flex direction="col"`. Kept as a back-compat
 * wrapper that now also accepts the `gap`/`align`/`justify` props.
 */
export function ColFlex(props: Omit<FlexProps, 'direction'>) {
  return <Flex data-slot="col-flex" direction="col" {...props} />
}

/**
 * @deprecated Use `HStack justify="between"`. Kept as a back-compat wrapper.
 */
export function SpaceBetweenRowFlex(props: Omit<FlexProps, 'direction' | 'justify'>) {
  return <Flex data-slot="space-between-row-flex" direction="row" justify="between" {...props} />
}
