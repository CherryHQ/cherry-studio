import { CSSProperties } from 'react'
import styled from 'styled-components'

interface ContainerProps {
  padding?: string
}

type PxValue = number | string

export interface BoxProps {
  width?: PxValue
  height?: PxValue
  w?: PxValue
  h?: PxValue
  color?: string
  background?: string
  flex?: string | number
  position?: CSSProperties['position']
  left?: PxValue
  top?: PxValue
  right?: PxValue
  bottom?: PxValue
  opacity?: string | number
  borderRadius?: PxValue
  border?: string
  gap?: PxValue
  mt?: PxValue
  marginTop?: PxValue
  mb?: PxValue
  marginBottom?: PxValue
  ml?: PxValue
  marginLeft?: PxValue
  mr?: PxValue
  marginRight?: PxValue
  m?: string
  margin?: string
  pt?: PxValue
  paddingTop?: PxValue
  pb?: PxValue
  paddingBottom?: PxValue
  pl?: PxValue
  paddingLeft?: PxValue
  pr?: PxValue
  paddingRight?: PxValue
  p?: string
  padding?: string
}

export interface StackProps extends BoxProps {
  justifyContent?: 'center' | 'flex-start' | 'flex-end' | 'space-between'
  alignItems?: 'center' | 'flex-start' | 'flex-end' | 'space-between'
  flexDirection?: 'row' | 'row-reverse' | 'column' | 'column-reverse'
}

export interface ButtonProps extends StackProps {
  color?: string
  isDisabled?: boolean
  isLoading?: boolean
  background?: string
  border?: string
  fontSize?: string
}

const cssRegex = /(px|vw|vh|%|auto)$/g

const getElementValue = (value?: PxValue) => {
  if (!value) {
    return value
  }

  if (typeof value === 'number') {
    return value + 'px'
  }

  if (value.match(cssRegex)) {
    return value
  }

  return value + 'px'
}

export const Box = ({
  width,
  w,
  height,
  h,
  color = 'default',
  background = 'default',
  flex = 'none',
  position,
  left = 'auto',
  right = 'auto',
  bottom = 'auto',
  top = 'auto',
  gap = 0,
  opacity = 1,
  borderRadius = 0,
  border = 'none',
  m,
  margin = 'none',
  mt,
  marginTop,
  mb,
  marginBottom,
  ml,
  marginLeft,
  mr,
  marginRight,
  p,
  padding = 'none',
  pt,
  paddingTop,
  pb,
  paddingBottom,
  pl,
  paddingLeft,
  pr,
  paddingRight,
  children,
  style
}: BoxProps & { children?: React.ReactNode; style?: CSSProperties }) => {
  const _style = {
    width: width || w ? getElementValue(width ?? w) : 'auto',
    height: height || h ? getElementValue(height ?? h) : 'auto',
    color,
    background,
    flex,
    position,
    left: getElementValue(left),
    right: getElementValue(right),
    bottom: getElementValue(bottom),
    top: getElementValue(top),
    gap: gap ? getElementValue(gap) : 0,
    opacity,
    borderRadius: getElementValue(borderRadius),
    boxSizing: 'border-box' as const,
    border,
    margin: m || margin,
    marginTop: mt || marginTop ? getElementValue(mt ?? marginTop) : 'default',
    marginBottom: mb || marginBottom ? getElementValue(mb ?? marginBottom) : 'default',
    marginLeft: ml || marginLeft ? getElementValue(ml ?? marginLeft) : 'default',
    marginRight: mr || marginRight ? getElementValue(mr ?? marginRight) : 'default',
    padding: p || padding,
    paddingTop: pt || paddingTop ? getElementValue(pt ?? paddingTop) : 'auto',
    paddingBottom: pb || paddingBottom ? getElementValue(pb ?? paddingBottom) : 'auto',
    paddingLeft: pl || paddingLeft ? getElementValue(pl ?? paddingLeft) : 'auto',
    paddingRight: pr || paddingRight ? getElementValue(pr ?? paddingRight) : 'auto',
    ...style
  } satisfies CSSProperties

  return <div style={_style}>{children}</div>
}

export const Stack = ({
  justifyContent = 'flex-start',
  alignItems = 'flex-start',
  flexDirection = 'row',
  children,
  ...props
}: StackProps & { children?: React.ReactNode }) => {
  const style = {
    display: 'flex',
    justifyContent,
    alignItems,
    flexDirection
  }

  return (
    <Box style={style} {...props}>
      {children}
    </Box>
  )
}

export const Center = ({
  children,
  ...props
}: Omit<StackProps, 'justifyContent' | 'alignItems'> & { children?: React.ReactNode }) => {
  return (
    <Stack justifyContent="center" alignItems="center" {...props}>
      {children}
    </Stack>
  )
}

export const RowFlex = ({ children, ...props }: Omit<StackProps, 'flexDirection'> & { children?: React.ReactNode }) => {
  return (
    <Stack {...props} flexDirection="row">
      {children}
    </Stack>
  )
}

export const SpaceBetweenRowFlex = ({
  children,
  ...props
}: Omit<StackProps, 'justifyContent'> & { children?: React.ReactNode }) => {
  return (
    <RowFlex justifyContent="space-between" {...props}>
      {children}
    </RowFlex>
  )
}

export const ColFlex = ({ children, ...props }: Omit<StackProps, 'flexDirection'> & { children?: React.ReactNode }) => {
  return (
    <Stack {...props} flexDirection="column">
      {children}
    </Stack>
  )
}

export const BaseTypography = styled(Box)<{
  fontSize?: number
  lineHeight?: string
  fontWeigth?: number | string
  color?: string
  textAlign?: string
}>`
  font-size: ${(props) => (props.fontSize ? getElementValue(props.fontSize) : '16px')};
  line-height: ${(props) => (props.lineHeight ? getElementValue(props.lineHeight) : 'normal')};
  font-weight: ${(props) => props.fontWeigth || 'normal'};
  color: ${(props) => props.color || '#fff'};
  text-align: ${(props) => props.textAlign || 'left'};
`

export const Container = styled.main<ContainerProps>`
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  flex: 1;
  padding: ${(p) => p.padding ?? '0 18px'};
`
