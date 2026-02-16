import type { SVGProps } from 'react'

/** Base SVG icon component type (matches SVGR output) */
export interface IconComponent {
  (props: SVGProps<SVGSVGElement>): React.JSX.Element
}

/** Compound icon with .Color and .Mono sub-components */
export interface CompoundIcon extends IconComponent {
  Color: IconComponent
  Mono: IconComponent
  colorPrimary: string
}

/** Per-provider icon metadata (authored in meta.ts) */
export interface IconMeta {
  /** Unique identifier, matches directory name. e.g. "openai" */
  id: string
  /** Primary brand color hex. e.g. "#000000" */
  colorPrimary: string
}

/** Generated catalog entry: metadata + component reference */
export interface CatalogEntry extends IconMeta {
  component: CompoundIcon
}

/** Icon component props */
export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Icon ID matching a catalog entry. e.g. "openai", "anthropic" */
  id: string
  /** Which variant to render */
  variant?: 'color' | 'mono'
  /** Icon size in px, or CSS string */
  size?: number | string
  /** Fallback when ID is not found */
  fallback?: React.ReactNode
}

/** IconAvatar component props */
export interface IconAvatarProps {
  /** Icon component or CompoundIcon */
  icon: IconComponent | CompoundIcon
  /** Size in px */
  size?: number
  /** Container shape */
  shape?: 'circle' | 'rounded'
  /** Background color, defaults to white */
  background?: string
  className?: string
}
