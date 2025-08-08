import { CaretDownOutlined, CaretRightOutlined } from '@ant-design/icons'
import React from 'react'

// Box 组件
export const Box: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { padding?: number; border?: string; borderStyle?: string; className?: string }
> = ({ padding: p, border, borderStyle, className, style, ...props }) => (
  <div
    className={className}
    style={{
      padding: p ? `${p}px` : undefined,
      border: border,
      borderStyle: borderStyle,
      ...style
    }}
    {...props}
  />
)

// SimpleGrid 组件
export const SimpleGrid: React.FC<{
  columns?: number
  templateColumns?: string
  children: React.ReactNode
  leftSpace?: number
  className?: string
  style?: React.CSSProperties
  onClick?: React.MouseEventHandler<HTMLDivElement>
}> = ({ columns, templateColumns, children, leftSpace = 0, style, className, onClick, ...props }) => (
  <div
    className={className}
    style={{
      display: 'grid',
      gridTemplateColumns: templateColumns || (columns ? `repeat(${columns}, 1fr)` : undefined),
      gap: '1px',
      paddingLeft: leftSpace,
      ...style
    }}
    onClick={onClick}
    {...props}>
    {children}
  </div>
)

// Text 组件
export const Text: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ style, className, ...props }) => (
  <span
    style={{ fontSize: 12, ...style, cursor: props.onClick ? 'pointer' : undefined }}
    className={className}
    {...props}
    onClick={props.onClick ? props.onClick : undefined}
  />
)

// VStack 组件
export const VStack: React.FC<{ grap?: number; align?: string; children: React.ReactNode }> = ({
  grap = 5,
  align = 'stretch',
  children,
  ...props
}) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: align,
      gap: `${grap}px`
    }}
    {...props}>
    {children}
  </div>
)

// GridItem 组件
export const GridItem: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { colSpan?: number; rowSpan?: number; padding?: number }
> = ({ colSpan, rowSpan, padding, style, ...props }) => (
  <div
    style={{
      gridColumn: colSpan ? `span ${colSpan}` : undefined,
      gridRow: rowSpan ? `span ${rowSpan}` : undefined,
      padding: padding ? `${padding}px` : undefined,
      textAlign: 'center',
      ...style
    }}
    {...props}
  />
)

// HStack 组件
export const HStack: React.FC<{ grap?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  grap,
  children,
  style,
  ...props
}) => (
  <div
    style={{
      display: 'inline-flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: grap ? `${grap}px` : '5px',
      ...style
    }}
    {...props}>
    {children}
  </div>
)

// IconButton 组件
export const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'sm' | 'md'; fontSize?: string }
> = ({ size = 'md', fontSize = '12px', style, onClick, ...props }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      width: size === 'sm' ? 12 : 20,
      height: 24,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontSize,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...style
    }}
    {...props}>
    {props.children ||
      (props['aria-label'] === 'Toggle' ? props['aria-expanded'] ? <CaretDownOutlined /> : <CaretRightOutlined /> : '')}
  </button>
)

// 自定义 Button 组件
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ style, ...props }) => (
  <button
    type="button"
    style={{
      padding: '5px 10px',
      border: 'none',
      cursor: 'pointer',
      ...style
    }}
    {...props}
  />
)

export const TraceIcon = ({ size = 200, color = 'currentColor', className = 'icon' }) => {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg">
      <path
        d="M919.296 515.072a93.3376 93.3376 0 0 0-31.6928 5.8368l-142.6944-214.1184a108.5952 108.5952 0 0 0 17.3056-58.7264 109.9776 109.9776 0 1 0-192.256 72.192l-143.8208 263.7312a151.5008 151.5008 0 0 0-40.96-6.0928 155.8528 155.8528 0 0 0-84.6848 25.1904l-115.2-138.24a93.2352 93.2352 0 0 0 11.4176-44.032 94.2592 94.2592 0 1 0-57.6 87.04l116.0704 139.264a157.3376 157.3376 0 1 0 226.9184-34.56l141.1072-258.7136a104.0384 104.0384 0 0 0 73.728-5.12l141.7728 212.6336a94.0032 94.0032 0 1 0 80.4864-46.08zM385.28 829.44a94.2592 94.2592 0 1 1 94.208-94.2592A94.3616 94.3616 0 0 1 385.28 829.44z m0 0"
        fill={color}
      />
    </svg>
  )
}
