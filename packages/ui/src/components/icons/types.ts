import type { SVGProps } from 'react'

/** Base SVG icon component type (matches SVGR output) */
export interface IconComponent {
  (props: SVGProps<SVGSVGElement>): React.JSX.Element
}

/** Props for the default theme-aware compound icon component.
 *
 * Without `variant`, the component renders both light and dark internally and
 * lets Tailwind's `dark:` modifier pick which one is visible.
 *
 * With `variant="light"` or `variant="dark"`, only the chosen variant renders.
 */
export interface CompoundIconProps extends SVGProps<SVGSVGElement> {
  variant?: 'light' | 'dark'
}

/** Compound icon: one theme-aware default component plus a circular `.Avatar`.
 *
 * Usage:
 *   <Anthropic />                  — auto light/dark (Tailwind `dark:` modifier)
 *   <Anthropic variant="light" />  — force light variant
 *   <Anthropic variant="dark" />   — force dark variant
 *   <Anthropic.Avatar />           — circular wrapper (separate concept)
 */
export interface CompoundIcon {
  (props: CompoundIconProps): React.JSX.Element
  Avatar: React.FC<Omit<IconAvatarProps, 'icon'>>
  colorPrimary: string
}

/** Per-provider icon metadata (authored in meta.ts) */
export interface IconMeta {
  /** Unique identifier, matches directory name. e.g. "openai" */
  id: string
  /** Primary brand color hex. e.g. "#000000" */
  colorPrimary: string
  /** Whether the source SVG is monochrome or colorful. Monochrome icons use currentColor in color.tsx. */
  colorScheme?: 'mono' | 'color'
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
  variant?: 'light' | 'dark'
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
