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
  position?: string
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

export const Box = styled.div<BoxProps>`
  width: ${(props) => (props.width || props.w ? getElementValue(props.width ?? props.w) : 'auto')};
  height: ${(props) => (props.height || props.h ? getElementValue(props.height || props.h) : 'auto')};
  color: ${(props) => props.color || 'default'};
  background: ${(props) => props.background || 'default'};
  flex: ${(props) => props.flex || 'none'};
  position: ${(props) => props.position || 'default'};
  left: ${(props) => getElementValue(props.left) || 'auto'};
  right: ${(props) => getElementValue(props.right) || 'auto'};
  bottom: ${(props) => getElementValue(props.bottom) || 'auto'};
  top: ${(props) => getElementValue(props.top) || 'auto'};
  gap: ${(p) => (p.gap ? getElementValue(p.gap) : 0)};
  opacity: ${(props) => props.opacity ?? 1};
  border-radius: ${(props) => getElementValue(props.borderRadius) || 0};
  box-sizing: border-box;
  border: ${(props) => props?.border || 'none'};
  gap: ${(p) => (p.gap ? getElementValue(p.gap) : 0)};
  margin: ${(props) => (props.m || props.margin ? (props.m ?? props.margin) : 'none')};
  margin-top: ${(props) => (props.mt || props.marginTop ? getElementValue(props.mt || props.marginTop) : 'default')};
  margin-bottom: ${(props) =>
    props.mb || props.marginBottom ? getElementValue(props.mb ?? props.marginBottom) : 'default'};
  margin-left: ${(props) => (props.ml || props.marginLeft ? getElementValue(props.ml ?? props.marginLeft) : 'default')};
  margin-right: ${(props) =>
    props.mr || props.marginRight ? getElementValue(props.mr ?? props.marginRight) : 'default'};
  padding: ${(props) => (props.p || props.padding ? (props.p ?? props.padding) : 'none')};
  padding-top: ${(props) => (props.pt || props.paddingTop ? getElementValue(props.pt ?? props.paddingTop) : 'auto')};
  padding-bottom: ${(props) =>
    props.pb || props.paddingBottom ? getElementValue(props.pb ?? props.paddingBottom) : 'auto'};
  padding-left: ${(props) => (props.pl || props.paddingLeft ? getElementValue(props.pl ?? props.paddingLeft) : 'auto')};
  padding-right: ${(props) =>
    props.pr || props.paddingRight ? getElementValue(props.pr ?? props.paddingRight) : 'auto'};
`

export const Stack = styled(Box)<StackProps>`
  display: flex;
  justify-content: ${(props) => props.justifyContent ?? 'flex-start'};
  align-items: ${(props) => props.alignItems ?? 'flex-start'};
  flex-direction: ${(props) => props.flexDirection ?? 'row'};
`

export const Center = styled(Stack)<StackProps>`
  justify-content: center;
  align-items: center;
`

export const HStack = styled(Stack)<StackProps>`
  flex-direction: row;
`

export const HSpaceBetweenStack = styled(HStack)<StackProps>`
  justify-content: space-between;
`

export const VStack = styled(Stack)<StackProps>`
  flex-direction: column;
`

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

export const TypographyNormal = styled(BaseTypography)`
  font-family: 'Ubuntu';
`

export const TypographyBold = styled(BaseTypography)`
  font-family: 'Ubuntu';
  font-weight: bold;
`

export const Container = styled.main<ContainerProps>`
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  flex: 1;
  padding: ${(p) => p.padding ?? '0 18px'};
`
