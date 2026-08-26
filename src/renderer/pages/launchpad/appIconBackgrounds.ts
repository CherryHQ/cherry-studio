import type { SidebarAppId } from '@renderer/utils/sidebar'

/** Forced launchpad glyph color. Adjacent mesh stops must clear the contrast floor. */
export const LAUNCHPAD_ICON_INK = '#FFFFFF'

/**
 * WCAG 2.1 SC 1.4.11 non-text contrast (3:1) for graphical objects that identify
 * the tile. Labels sit outside the mesh and use `--foreground`.
 */
export const MIN_LAUNCHPAD_ICON_CONTRAST = 3

export function hexContrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b))
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(hex: string): number {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex
  if (normalized.length !== 6) {
    throw new Error(`Expected #RRGGBB, received ${hex}`)
  }

  const value = Number.parseInt(normalized, 16)
  if (Number.isNaN(value)) {
    throw new Error(`Invalid hex color ${hex}`)
  }

  return (
    0.2126 * srgbChannel((value >> 16) & 255) +
    0.7152 * srgbChannel((value >> 8) & 255) +
    0.0722 * srgbChannel(value & 255)
  )
}

function srgbChannel(channel: number): number {
  const s = channel / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export const mesh = (c1: string, c2: string, c3: string) => `linear-gradient(140deg, ${c1} 0%, ${c2} 50%, ${c3} 100%)`

// Grayscale film grain (SVG turbulence) layered under launchpad artwork.
export const LAUNCHPAD_ICON_GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

type MeshStops = readonly [string, string, string]

// Each stop is a Tailwind default-palette hex that clears 3:1 against white.
// Light uses ~500–700 cores; dark steps one shade deeper so theme switch stays visible.
export const APP_ICON_MESH_STOPS_LIGHT = {
  assistants: ['#3B82F6', '#2563EB', '#4F46E5'],
  agents: ['#0284C7', '#0369A1', '#0E7490'],
  paintings: ['#EC4899', '#DB2777', '#BE185D'],
  translate: ['#16A34A', '#15803D', '#166534'],
  mini_app: ['#8B5CF6', '#7C3AED', '#6D28D9'],
  knowledge: ['#65A30D', '#4D7C0F', '#3F6212'],
  files: ['#D97706', '#B45309', '#C2410C'],
  code_tools: ['#6366F1', '#4F46E5', '#4338CA'],
  notes: ['#EA580C', '#C2410C', '#9A3412']
} as const satisfies Record<SidebarAppId, MeshStops>

export const APP_ICON_MESH_STOPS_DARK = {
  assistants: ['#2563EB', '#1D4ED8', '#4338CA'],
  agents: ['#0369A1', '#075985', '#0E7490'],
  paintings: ['#DB2777', '#BE185D', '#9D174D'],
  translate: ['#15803D', '#166534', '#14532D'],
  mini_app: ['#7C3AED', '#6D28D9', '#5B21B6'],
  knowledge: ['#4D7C0F', '#3F6212', '#365314'],
  files: ['#B45309', '#92400E', '#78350F'],
  code_tools: ['#4F46E5', '#4338CA', '#3730A3'],
  notes: ['#C2410C', '#9A3412', '#7C2D12']
} as const satisfies Record<SidebarAppId, MeshStops>

function toMeshBackgrounds(stops: Record<SidebarAppId, MeshStops>): Record<SidebarAppId, string> {
  return Object.fromEntries(
    (Object.entries(stops) as [SidebarAppId, MeshStops][]).map(([id, [c1, c2, c3]]) => [id, mesh(c1, c2, c3)])
  ) as Record<SidebarAppId, string>
}

export const APP_ICON_BACKGROUNDS_LIGHT = toMeshBackgrounds(APP_ICON_MESH_STOPS_LIGHT)
export const APP_ICON_BACKGROUNDS_DARK = toMeshBackgrounds(APP_ICON_MESH_STOPS_DARK)
