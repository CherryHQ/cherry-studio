'use client'

import type { ComponentType, CSSProperties, SVGProps } from 'react'

type SVGComponent = ComponentType<SVGProps<SVGSVGElement>>

interface MonoIconProps {
  /**
   * The icon component to render
   */
  icon: SVGComponent
  /**
   * Size of the icon (defaults to '1em')
   */
  size?: string | number
  /**
   * Additional class name
   */
  className?: string
  /**
   * Additional styles
   */
  style?: CSSProperties
  /**
   * Mono mode: 'dark' makes icon black, 'light' makes icon white
   * Default is 'dark' (black icon)
   */
  mode?: 'dark' | 'light'
}

/**
 * MonoIcon - Renders any colored SVG icon in monochrome (black or white)
 *
 * Uses CSS filter to convert colored icons to pure black or white.
 * Useful for consistent icon appearance regardless of original colors.
 *
 * Note: This does NOT make icons use currentColor. For that, you need
 * to modify the SVG source to use fill="currentColor".
 *
 * Usage:
 * ```tsx
 * import { Anthropic } from '@cherrystudio/ui/icons/logos'
 * import { MonoIcon } from '@cherrystudio/ui/icons/MonoIcon'
 *
 * // Black icon (for light backgrounds)
 * <MonoIcon icon={Anthropic} size={24} mode="dark" />
 *
 * // White icon (for dark backgrounds)
 * <MonoIcon icon={Anthropic} size={24} mode="light" />
 * ```
 */
export function MonoIcon({ icon: Icon, size = '1em', style, className, mode = 'dark' }: MonoIconProps) {
  const sizeValue = typeof size === 'number' ? `${size}px` : size

  // CSS filter to convert any colored icon to black or white
  // brightness(0) saturate(100%) -> makes everything black
  // invert(1) -> makes everything white
  const filter = mode === 'dark' ? 'brightness(0) saturate(100%)' : 'brightness(0) saturate(100%) invert(1)'

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: sizeValue,
        height: sizeValue,
        ...style
      }}>
      <Icon
        style={{
          width: '100%',
          height: '100%',
          filter
        }}
      />
    </span>
  )
}

/**
 * ColorIcon - Renders icon with original colors
 */
export function ColorIcon({ icon: Icon, size = '1em', style, className }: Omit<MonoIconProps, 'mode'>) {
  const sizeValue = typeof size === 'number' ? `${size}px` : size
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: sizeValue,
        height: sizeValue,
        ...style
      }}>
      <Icon style={{ width: '100%', height: '100%' }} />
    </span>
  )
}

/**
 * GrayscaleIcon - Renders icon in grayscale (preserves luminance)
 */
export function GrayscaleIcon({ icon: Icon, size = '1em', style, className }: Omit<MonoIconProps, 'mode'>) {
  const sizeValue = typeof size === 'number' ? `${size}px` : size
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: sizeValue,
        height: sizeValue,
        ...style
      }}>
      <Icon
        style={{
          width: '100%',
          height: '100%',
          filter: 'grayscale(100%)'
        }}
      />
    </span>
  )
}

/**
 * Creates a dark monochrome version of any icon component
 */
export function createMonoIcon(Icon: SVGComponent, mode: 'dark' | 'light' = 'dark') {
  const MonoComponent = (props: { className?: string; style?: CSSProperties; size?: string | number }) => (
    <MonoIcon icon={Icon} mode={mode} {...props} />
  )
  MonoComponent.displayName = `Mono(${Icon.displayName || Icon.name || 'Icon'})`
  return MonoComponent
}

export default MonoIcon
