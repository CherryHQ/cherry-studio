import type * as Merman from '@mermanjs/web-render'
import type { HostTextMeasurer } from '@mermanjs/web-render'

import { createCanvasTextMeasurer } from './canvas-text-measurer'
import { ensureFontFaces } from './fonts'
import type { MermaidTheme } from './theme'

type MermanModule = typeof Merman

let runtime: Promise<{ merman: MermanModule; measure: HostTextMeasurer }> | null = null

/** Loads and initializes the Merman WASM runtime once per realm; a failed load is retried on the next call. */
export function loadMermaidRuntime() {
  runtime ??= import('@mermanjs/web-render')
    .then(async (merman) => {
      await merman.initMerman()
      // Canvas measurement works on the page and in a Web Worker alike, so both produce identical layouts.
      return { merman, measure: createCanvasTextMeasurer() }
    })
    .catch((error: unknown) => {
      runtime = null
      throw error
    })
  return runtime
}

const SCOPED_CSS = [
  '[filter*="drop-shadow"] { filter: none; }',
  // Merman 0.9.2 centres labels with `alignment-baseline`, which Chromium ignores on <text>; Mermaid.js
  // also sets `dominant-baseline`, which is what centres them. Drop once Merman emits it.
  'text[alignment-baseline="central"] { dominant-baseline: central; }',
  'text[alignment-baseline="middle"] { dominant-baseline: middle; }'
].join('\n')

/**
 * Merman's `interactive` profile caps layout work low enough to reject a 200-node flowchart. Render off the
 * main thread and let the host stop a worker that overruns its deadline instead of refusing those diagrams.
 */
const LAYOUT_WORK_LIMIT = 400_000_000

export interface RenderMermaidOptions {
  theme: MermaidTheme
  /** Unique within the document that will host the SVG. */
  diagramId?: string
}

/** Renders Mermaid source to an SVG string styled by `theme`; throws an Error with Merman's message on invalid source. */
export async function renderMermaidSvg(source: string, { theme, diagramId }: RenderMermaidOptions): Promise<string> {
  const fontSet = typeof document === 'undefined' ? (self as unknown as { fonts: FontFaceSet }).fonts : document.fonts
  const [{ merman, measure }] = await Promise.all([loadMermaidRuntime(), ensureFontFaces(theme.fontFaces, fontSet)])
  try {
    return merman.renderSvgWithTextMeasurer(source, measure, {
      presentation: {
        theme: {
          appearance: theme.appearance,
          font_family: theme.fontFamily,
          font_size: theme.fontSize,
          roles: theme.roles,
          series_palette: theme.seriesPalette
        }
      },
      // The design system keeps static content flat: drop shadows come from a theme variable for most
      // families and from SVG filter references for sequence actors, so turn off both.
      site_config: { themeVariables: { dropShadow: 'none' } },
      svg: { diagram_id: diagramId, root_background_color: 'transparent', scoped_css: SCOPED_CSS },
      resources: { profile: 'interactive', limits: { max_layout_work_units: LAYOUT_WORK_LIMIT } }
    })
  } catch (error) {
    throw toError(error)
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return new Error(error.message)
  }
  return new Error(String(error))
}
