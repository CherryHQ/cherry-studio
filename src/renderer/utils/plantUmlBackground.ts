const SKINPARAM_BACKGROUND = /^\s*skinparam\s+backgroundColor\s+(\S+)/im

// A single-token value that is safe to hand to CSS: hex colors and named colors.
// Anything else (gradients, PlantUML-specific syntax) is left to the engine.
const SAFE_CSS_COLOR = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/

/**
 * Apply the source's `skinparam backgroundColor` to the rendered SVG.
 *
 * The bundled headless PlantUML engine always emits `background:#FFFFFF` on
 * the root `<svg>` element and no background rect, so an explicit background
 * skinparam is silently dropped and, for example, white arrows disappear
 * against the forced white preview background. When the source declares a
 * simple background color, rewrite the root element's background to match.
 */
export function applyBackgroundSkinparam(source: string, svg: string): string {
  const color = SKINPARAM_BACKGROUND.exec(source)?.[1]
  if (!color || !SAFE_CSS_COLOR.test(color)) return svg

  const openTagEnd = svg.indexOf('>')
  if (openTagEnd === -1 || !svg.startsWith('<svg')) return svg

  const openTag = svg.slice(0, openTagEnd)
  if (!/background\s*:/.test(openTag)) return svg

  const patched = openTag.replace(/background\s*:[^;"]+/, `background:${color}`)
  return patched === openTag ? svg : patched + svg.slice(openTagEnd)
}
