import React from 'react'

import { cn } from '../../../utils'

export interface BoxProps extends React.ComponentProps<'div'> {}

export const Box = ({ children, className, ...props }: BoxProps & { children?: React.ReactNode }) => {
  return (
    <div className={cn('box-border', className)} {...props}>
      {children}
    </div>
  )
}

export interface FlexProps extends BoxProps {}

export const Flex = ({ children, className, ...props }: FlexProps & { children?: React.ReactNode }) => {
  return (
    <Box className={cn('flex', className)} {...props}>
      {children}
    </Box>
  )
}

export const RowFlex = ({ children, className, ...props }: FlexProps & { children?: React.ReactNode }) => {
  return (
    <Flex className={cn('flex-row', className)} {...props}>
      {children}
    </Flex>
  )
}

export const SpaceBetweenRowFlex = ({ children, className, ...props }: FlexProps & { children?: React.ReactNode }) => {
  return (
    <RowFlex className={cn('justify-between', className)} {...props}>
      {children}
    </RowFlex>
  )
}
export const ColFlex = ({ children, className, ...props }: FlexProps & { children?: React.ReactNode }) => {
  return (
    <Flex className={cn('flex-col', className)} {...props}>
      {children}
    </Flex>
  )
}

export const Center = ({ children, className, ...props }: FlexProps & { children?: React.ReactNode }) => {
  return (
    <Flex className={cn('items-center justify-center', className)} {...props}>
      {children}
    </Flex>
  )
}

export default {
  Box,
  Flex,
  RowFlex,
  SpaceBetweenRowFlex,
  ColFlex,
  Center
}
