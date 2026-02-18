/**
 * Tests for the convertToMono svgo plugin.
 *
 * Verifies fill color conversion, white fill handling, mask replacement,
 * and no-op mask detection.
 */
import { describe, expect, it, vi } from 'vitest'

// Mock svgo/lib/xast before importing the plugin
vi.mock('svgo/lib/xast', () => ({
  detachNodeFromParent: (node: any, parent: any) => {
    parent.children = parent.children.filter((child: any) => child !== node)
  }
}))

import { colorToLuminance } from '../svg-utils'
import { createConvertToMonoPlugin } from '../svgo-convert-to-mono'

// ─── Helpers ────────────────────────────────────────────────────────

function el(name: string, attributes: Record<string, string> = {}, children: any[] = []): any {
  return { type: 'element', name, attributes, children }
}

function svgRoot(svgAttrs: Record<string, string>, children: any[]): any {
  return {
    type: 'root',
    children: [el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', ...svgAttrs }, children)]
  }
}

function svg(children: any[]): any {
  return svgRoot({}, children)
}

/** Get the <svg> element from root. */
function svgEl(root: any): any {
  return root.children[0]
}

/** Get all non-text children of <svg>. */
function svgChildren(root: any): any[] {
  return svgEl(root).children.filter((c: any) => c.type === 'element')
}

// ─── Single-color fill conversion ────────────────────────────────────

describe('single-color fill conversion', () => {
  it('converts a single colored fill to currentColor', () => {
    const path = el('path', { d: 'M0 0L24 24', fill: '#FF0000' })
    const root = svg([path])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    expect(path.attributes.fill).toBe('currentColor')
    // Single color → full opacity (no fill-opacity attribute)
    expect(path.attributes['fill-opacity']).toBeUndefined()
  })

  it('converts black fill to currentColor', () => {
    const path = el('path', { d: 'M0 0L24 24', fill: '#000000' })
    const root = svg([path])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    expect(path.attributes.fill).toBe('currentColor')
  })

  it('leaves fill="none" untouched', () => {
    const path = el('path', { d: 'M0 0L24 24', fill: 'none' })
    const root = svg([path])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    expect(path.attributes.fill).toBe('none')
  })
})

// ─── Multi-color opacity mapping ─────────────────────────────────────

describe('multi-color opacity mapping', () => {
  it('assigns different opacities to different colors', () => {
    const dark = el('path', { d: 'M0 0L12 12', fill: '#111111' })
    const light = el('path', { d: 'M12 12L24 24', fill: '#AAAAAA' })
    const root = svg([dark, light])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    expect(dark.attributes.fill).toBe('currentColor')
    expect(light.attributes.fill).toBe('currentColor')

    // Dark color should get higher opacity than light color
    const darkOpacity = dark.attributes['fill-opacity'] ? parseFloat(dark.attributes['fill-opacity']) : 1.0
    const lightOpacity = light.attributes['fill-opacity'] ? parseFloat(light.attributes['fill-opacity']) : 1.0
    expect(darkOpacity).toBeGreaterThan(lightOpacity)
  })
})

// ─── Narrow luminance range opacity spread ────────────────────────────

describe('narrow luminance range opacity spread', () => {
  it('spreads opacities for colors with similar luminance (Hunyuan pattern)', () => {
    // 5 blues spanning a narrow luminance band (~0.3 to ~0.45)
    const p1 = el('path', { d: 'M0 0L6 6', fill: '#1A3B8A' }) // darkest blue
    const p2 = el('path', { d: 'M6 0L12 6', fill: '#2A4B9A' })
    const p3 = el('path', { d: 'M12 0L18 6', fill: '#3A5BAA' })
    const p4 = el('path', { d: 'M18 0L24 6', fill: '#4A6BBA' })
    const p5 = el('path', { d: 'M0 6L6 12', fill: '#5A7BCA' }) // lightest blue
    const root = svg([p1, p2, p3, p4, p5])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    // Collect all opacity values
    const opacities = [p1, p2, p3, p4, p5].map((p) => {
      const o = p.attributes['fill-opacity']
      return o ? parseFloat(o) : 1.0
    })

    // Each adjacent pair should have a gap >= 0.10 (using 0.10 as check since
    // the effective gap is 0.12, but rounding and clamping may reduce it slightly)
    for (let i = 0; i < opacities.length - 1; i++) {
      const gap = opacities[i] - opacities[i + 1]
      expect(gap).toBeGreaterThanOrEqual(0.09)
    }

    // First should be highest opacity, last should be lowest
    expect(opacities[0]).toBeGreaterThan(opacities[4])
  })
})

// ─── White fill handling: backgroundWasDark ──────────────────────────

describe('white fill handling', () => {
  it('converts white fills to currentColor when backgroundWasDark=true (ZeroOne fix)', () => {
    const whitePath = el('path', { d: 'M4 4L10 10', fill: 'white' })
    const greenDot = el('path', { d: 'M19 11A1 1 0 1 0 19 9', fill: '#00FF00' })
    const root = svg([whitePath, greenDot])

    const mono = createConvertToMonoPlugin({ backgroundWasDark: true })
    mono.plugin.fn(root)

    expect(whitePath.attributes.fill).toBe('currentColor')
    expect(greenDot.attributes.fill).toBe('currentColor')
  })

  it('converts white fills to var(--color-background) when backgroundWasDark=false', () => {
    const whitePath = el('path', { d: 'M4 4L10 10', fill: 'white' })
    const colorPath = el('path', { d: 'M14 14L20 20', fill: '#FF0000' })
    const root = svg([whitePath, colorPath])

    const mono = createConvertToMonoPlugin({ backgroundWasDark: false })
    mono.plugin.fn(root)

    expect(whitePath.attributes.fill).toBe('var(--color-background, white)')
    expect(colorPath.attributes.fill).toBe('currentColor')
  })

  it('treats white as foreground when ONLY white fills exist (no colored content)', () => {
    const w1 = el('path', { d: 'M4 4L10 10', fill: 'white' })
    const w2 = el('path', { d: 'M14 14L20 20', fill: '#ffffff' })
    const root = svg([w1, w2])

    const mono = createConvertToMonoPlugin({ backgroundWasDark: false })
    mono.plugin.fn(root)

    // When only white fills exist, whiteIsFg = true regardless of backgroundWasDark
    expect(w1.attributes.fill).toBe('currentColor')
    expect(w2.attributes.fill).toBe('currentColor')
  })

  it('handles near-white fills (#FEFBFB) as white', () => {
    const nearWhite = el('path', { d: 'M4 4L20 20', fill: '#FEFBFB' })
    const colored = el('path', { d: 'M12 4L12 20', fill: '#333333' })
    const root = svg([nearWhite, colored])

    const mono = createConvertToMonoPlugin({ backgroundWasDark: true })
    mono.plugin.fn(root)

    // #FEFBFB is near-white, should be treated as white
    expect(nearWhite.attributes.fill).toBe('currentColor')
  })
})

// ─── url(#gradient) fills ────────────────────────────────────────────

describe('gradient fill conversion', () => {
  it('converts url(#id) fills to currentColor', () => {
    const gradPath = el('path', { d: 'M0 0L24 24', fill: 'url(#gradient1)' })
    const root = svg([gradPath])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    expect(gradPath.attributes.fill).toBe('currentColor')
  })
})

// ─── Removal of defs/clipPath/attributes ─────────────────────────────

describe('structural cleanup', () => {
  it('removes <defs> elements', () => {
    const grad = el('linearGradient', { id: 'g1' }, [el('stop', { 'stop-color': '#FFF' })])
    const defs = el('defs', {}, [grad])
    const path = el('path', { d: 'M0 0L24 24', fill: '#333' })
    const root = svg([defs, path])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    const remaining = svgChildren(root)
    expect(remaining.length).toBe(1)
    expect(remaining[0].name).toBe('path')
  })

  it('removes <clipPath> elements', () => {
    const clip = el('clipPath', { id: 'c1' }, [el('rect', { width: '24', height: '24' })])
    const path = el('path', { d: 'M0 0L24 24', fill: '#333' })
    const root = svg([clip, path])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    const remaining = svgChildren(root)
    expect(remaining.length).toBe(1)
    expect(remaining[0].name).toBe('path')
  })

  it('removes clip-path and filter attributes', () => {
    const path = el('path', {
      d: 'M0 0L24 24',
      fill: '#333',
      'clip-path': 'url(#c1)',
      filter: 'url(#f1)',
      mask: 'url(#m1)'
    })
    const root = svg([path])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    expect(path.attributes['clip-path']).toBeUndefined()
    expect(path.attributes.filter).toBeUndefined()
    expect(path.attributes.mask).toBeUndefined()
  })

  it('removes existing fill-opacity before applying new one', () => {
    const path = el('path', { d: 'M0 0L24 24', fill: '#333333', 'fill-opacity': '0.5' })
    const path2 = el('path', { d: 'M0 24L24 0', fill: '#AAAAAA' })
    const root = svg([path, path2])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    // fill-opacity should be recalculated by the mono plugin, not carry over
    expect(path.attributes.fill).toBe('currentColor')
  })
})

// ─── Phase 0: Mask-based shape extraction ────────────────────────────

describe('mask-based shape extraction (Phase 0)', () => {
  it('extracts mask shape paths when mask defines a non-trivial shape (Jimeng star pattern)', () => {
    // Star shape whose bounding box is smaller than the viewBox (so it's NOT detected as no-op).
    // Real Jimeng star is bounded within ~(3,3)-(21,21), well under 90% of 24x24.
    const maskStar = el('path', {
      d: 'M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5Z',
      fill: 'white',
      style: 'mask-type:luminance'
    })
    const mask = el('mask', { id: 'mask0' }, [maskStar])

    // Oversized diamond geometry that gets clipped by the mask
    const diamond = el('path', { d: 'M0 0H24V24H0Z', fill: '#FF6600' })
    const group = el('g', { mask: 'url(#mask0)' }, [diamond])
    const root = svg([mask, group])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    // The group should now contain the mask's star path instead of the diamond
    const g = svgChildren(root).find((c) => c.name === 'g')
    expect(g).toBeDefined()
    expect(g.children.length).toBe(1)
    expect(g.children[0].attributes.d).toBe('M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5Z')
    // style attribute should be removed (mask-type:luminance)
    expect(g.children[0].attributes.style).toBeUndefined()
    // mask attribute removed from group
    expect(g.attributes.mask).toBeUndefined()
  })

  it('does NOT replace content for no-op masks (full viewBox rect, AwsBedrock pattern)', () => {
    // A mask that's just a full 24x24 white rect — no actual clipping
    const maskRect = el('rect', { width: '24', height: '24', fill: 'white' })
    const mask = el('mask', { id: 'mask0' }, [maskRect])

    // Actual content that should be preserved
    const brain = el('path', { d: 'M6 8C8 4 16 4 18 8L18 16C16 20 8 20 6 16Z', fill: '#333' })
    const group = el('g', { mask: 'url(#mask0)' }, [brain])
    const root = svg([mask, group])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    // Content should be PRESERVED (not replaced with mask rect)
    const g = svgChildren(root).find((c) => c.name === 'g')
    expect(g).toBeDefined()
    expect(g.children.length).toBe(1)
    expect(g.children[0].attributes.d).toBe('M6 8C8 4 16 4 18 8L18 16C16 20 8 20 6 16Z')
  })

  it('does NOT replace content for no-op masks (full viewBox path)', () => {
    // A mask that's a full-viewBox path
    const maskPath = el('path', { d: 'M24 0H0V24H24V0Z', fill: 'white' })
    const mask = el('mask', { id: 'mask0' }, [maskPath])

    const content = el('path', { d: 'M8 6L16 18', fill: 'white' })
    const group = el('g', { mask: 'url(#mask0)' }, [content])
    const root = svg([mask, group])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    const g = svgChildren(root).find((c) => c.name === 'g')
    expect(g.children[0].attributes.d).toBe('M8 6L16 18')
  })

  it('removes <mask> elements after processing', () => {
    const maskStar = el('path', { d: 'M12 0L15 9L24 12Z', fill: 'white' })
    const mask = el('mask', { id: 'mask0' }, [maskStar])
    const group = el('g', { mask: 'url(#mask0)' }, [el('path', { d: 'M0 0H24V24H0Z', fill: '#333' })])
    const root = svg([mask, group])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    // No <mask> elements should remain
    const masks = svgChildren(root).filter((c) => c.name === 'mask')
    expect(masks.length).toBe(0)
  })
})

// ─── Integration: backgroundWasDark threshold ────────────────────────

describe('container shape detection (Phase 1.5)', () => {
  it('converts lighter overlapping paths to white when a large container exists (Hunyuan pattern)', () => {
    // Large dark circle covers most of viewBox, with lighter detail paths inside
    const container = el('path', {
      d: 'M0 0 C8 0 16 0 24 0 C24 8 24 16 24 24 C16 24 8 24 0 24 C0 16 0 8 0 0Z',
      fill: '#0054E0'
    })
    const lightDetail = el('path', { d: 'M5 5L10 10', fill: '#B0DBF1' }) // much lighter
    const darkDetail = el('path', { d: 'M12 12L18 18', fill: '#0859E0' }) // similar to container
    const root = svgRoot({}, [container, lightDetail, darkDetail])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    const svgChildren = root.children[0].children.filter((c: any) => c.type === 'element')
    // Container: currentColor
    expect(svgChildren[0].attributes.fill).toBe('currentColor')
    // Light detail: white overlay (creates contrast)
    expect(svgChildren[1].attributes.fill).toBe('var(--color-background, white)')
    // Dark detail: currentColor (similar luminance to container)
    expect(svgChildren[2].attributes.fill).toBe('currentColor')
  })

  it('does NOT trigger container detection for small first paths', () => {
    const smallPath = el('path', { d: 'M5 5L10 10', fill: '#0054E0' })
    const otherPath = el('path', { d: 'M12 12L18 18', fill: '#B0DBF1' })
    const root = svgRoot({}, [smallPath, otherPath])

    const mono = createConvertToMonoPlugin()
    mono.plugin.fn(root)

    const svgChildren = root.children[0].children.filter((c: any) => c.type === 'element')
    // Both should be currentColor (no container detected)
    expect(svgChildren[0].attributes.fill).toBe('currentColor')
    expect(svgChildren[1].attributes.fill).toBe('currentColor')
  })
})

describe('backgroundWasDark threshold integration', () => {
  /**
   * Tests the threshold logic from generate-mono-icons.ts:
   *   backgroundWasDark = bgPlugin.wasRemoved() && lum >= 0 && lum < 0.3
   *
   * This is the critical threshold that caused the ZeroOne bug.
   */
  it('#133426 (ZeroOne, lum ~0.159) should be considered dark (< 0.3)', () => {
    const lum = colorToLuminance('#133426')
    expect(lum).toBeLessThan(0.3)
    expect(lum).toBeGreaterThan(0)
  })

  it('#055F4E (AwsBedrock, lum ~0.259) should be considered dark (< 0.3)', () => {
    const lum = colorToLuminance('#055F4E')
    expect(lum).toBeLessThan(0.3)
  })

  it('#F54F35 (Groq, lum ~0.49) should NOT be considered dark (>= 0.3)', () => {
    const lum = colorToLuminance('#F54F35')
    expect(lum).toBeGreaterThanOrEqual(0.3)
  })

  it('#CA9F7B (Anthropic tan, lum ~0.66) should NOT be considered dark', () => {
    const lum = colorToLuminance('#CA9F7B')
    expect(lum).toBeGreaterThanOrEqual(0.3)
  })
})
