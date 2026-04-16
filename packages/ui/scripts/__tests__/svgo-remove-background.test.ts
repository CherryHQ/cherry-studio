/**
 * Tests for the removeBackground svgo plugin.
 *
 * We build minimal xast trees and call the plugin's fn() directly,
 * then inspect the tree to see which nodes were detached.
 */
import { describe, expect, it, vi } from 'vitest'

// Mock svgo/lib/xast before importing the plugin
vi.mock('svgo/lib/xast', () => ({
  detachNodeFromParent: (node: any, parent: any) => {
    parent.children = parent.children.filter((child: any) => child !== node)
  }
}))

import { createRemoveBackgroundPlugin } from '../svgo-remove-background'

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

function childCount(root: any): number {
  return root.children[0].children.filter((c: any) => c.type === 'element').length
}

// ─── Rule 1: <rect> background ──────────────────────────────────────

describe('Rule 1: rect background removal', () => {
  it('removes <rect> covering full viewBox (Groq pattern)', () => {
    const bgRect = el('rect', { width: '24', height: '24', fill: '#F54F35' })
    const fgPath = el('path', { d: 'M15 5L10 20', fill: '#FEFBFB' })
    const root = svgRoot({}, [bgRect, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#F54F35')
    expect(childCount(root)).toBe(1)
    expect(root.children[0].children[0]).toBe(fgPath)
  })

  it('removes <rect> covering 70% of viewBox', () => {
    const bgRect = el('rect', { width: '17', height: '17', fill: '#336699' })
    const fgPath = el('path', { d: 'M10 10L12 12', fill: 'white' })
    const root = svgRoot({}, [bgRect, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#336699')
  })

  it('does NOT remove <rect> smaller than 70% viewBox', () => {
    const smallRect = el('rect', { width: '10', height: '10', fill: '#336699' })
    const root = svgRoot({}, [smallRect])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(false)
    expect(bg.getBackgroundFill()).toBeNull()
    expect(childCount(root)).toBe(1)
  })

  it('captures null backgroundFill for white rect backgrounds', () => {
    const whiteRect = el('rect', { width: '24', height: '24', fill: '#ffffff' })
    const fgPath = el('path', { d: 'M5 5L20 20', fill: '#333' })
    const root = svgRoot({}, [whiteRect, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBeNull()
  })

  it('resolves gradient fill on <rect> via url(#id) (LMStudio pattern)', () => {
    const grad = el('linearGradient', { id: 'paint0' }, [
      el('stop', { 'stop-color': '#6D7DF2' }),
      el('stop', { offset: '1', 'stop-color': '#4E13BE' })
    ])
    const defs = el('defs', {}, [grad])
    const bgRect = el('rect', { width: '24', height: '24', fill: 'url(#paint0)', rx: '2' })
    const fgPath = el('path', { d: 'M4 4H12', fill: 'white' })
    const root = svgRoot({}, [defs, bgRect, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#6D7DF2')
  })
})

// ─── Rule 2: Rounded-rect path background ───────────────────────────

describe('Rule 2: rounded-rect path background', () => {
  it('removes rounded-rect path (Anthropic M18 0H6C... pattern)', () => {
    const bgPath = el('path', {
      d: 'M18 0H6C2.68629 0 0 2.68629 0 6V18C0 21.3137 2.68629 24 6 24H18C21.3137 24 24 21.3137 24 18V6C24 2.68629 21.3137 0 18 0Z',
      fill: '#CA9F7B'
    })
    const fgPath = el('path', { d: 'M8 6L12 18L16 6', fill: '#191919' })
    const root = svgRoot({}, [bgPath, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#CA9F7B')
    expect(childCount(root)).toBe(1)
  })

  it('handles decimal coords like 4.99999 (AwsBedrock pattern)', () => {
    const bgPath = el('path', {
      d: 'M18.5455 0H4.99999C2.44208 0 0 2.44208 0 5.45455V18.5455C0 21.5579 2.44208 24 24 18.5455V5.45455C24 2.44208 21.5579 0 18.5455 0Z',
      fill: 'url(#paint0_linear)'
    })
    const grad = el('linearGradient', { id: 'paint0_linear' }, [
      el('stop', { 'stop-color': '#055F4E' }),
      el('stop', { offset: '1', 'stop-color': '#47A286' })
    ])
    const defs = el('defs', {}, [grad])
    const fgPath = el('path', { d: 'M12 6L8 18', fill: 'white' })
    const root = svgRoot({}, [defs, bgPath, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#055F4E')
  })

  it('removes rounded-rect path with Arc (A) commands (Sora pattern)', () => {
    const bgPath = el('path', {
      d: 'M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z',
      fill: '#012659'
    })
    const fgPath = el('path', { d: 'M10 8L14 16', fill: 'white' })
    const root = svgRoot({}, [bgPath, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#012659')
    expect(childCount(root)).toBe(1)
  })

  it('removes ZeroOne dark green rounded-rect (#133426)', () => {
    const bgPath = el('path', {
      d: 'M18.5455 0H5.45455C2.44208 0 0 2.44208 0 5.45455V18.5455C0 21.5579 2.44208 24 5.45455 24H18.5455C21.5579 24 24 21.5579 24 18.5455V5.45455C24 2.44208 21.5579 0 18.5455 0Z',
      fill: '#133426'
    })
    const fgPath = el('path', { d: 'M4 4L10 10', fill: 'white' })
    const root = svgRoot({}, [bgPath, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#133426')
  })
})

// ─── Rule 3: Large dark traced background ────────────────────────────

describe('Rule 3: large dark traced background', () => {
  it('removes large dark path covering >= 90% viewBox when white fg exists (Cephalon/Moonshot pattern)', () => {
    // Large black traced path (covering full viewBox)
    const bgPath = el('path', {
      d: 'M0 0H24V24H0V0Z',
      fill: '#000000'
    })
    const fgPath = el('path', { d: 'M6 8L18 16', fill: 'white' })
    const root = svgRoot({}, [bgPath, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#000000')
  })

  it('does NOT remove dark complex path when no white foreground content', () => {
    // Use a complex traced path (not a simple rect pattern that Rule 2 catches)
    const bgPath = el('path', {
      d: 'M0.5 0.2C0.5 0.1 0.3 0 0.2 0L23.8 0C23.7 0 23.5 0.1 23.5 0.2V23.8C23.5 23.9 23.7 24 23.8 24L0.2 24C0.3 24 0.5 23.9 0.5 23.8Z',
      fill: '#000000'
    })
    const fgPath = el('path', { d: 'M6 8L18 16', fill: '#FF0000' })
    const root = svgRoot({}, [bgPath, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    // Rule 3 requires white fg paths; only red fg here → should not remove
    expect(bg.wasRemoved()).toBe(false)
  })
})

// ─── Rule 3c: Traced vectorized background with near-white foreground ─

describe('Rule 3c: traced vectorized background with near-white foreground', () => {
  it('removes first large path (>= 85% viewBox) when near-white foreground exists (IBM pattern)', () => {
    // IBM: dark blue background traced by vectorizer, with light gray text paths
    const bgPath = el('path', {
      d: 'M0 0 C66 0 132 0 200 0 C200 66 200 132 200 200 C132 200 66 200 0 200 C0 132 0 66 0 0Z',
      fill: '#002D72'
    })
    const textPath1 = el('path', { d: 'M40 80L60 80L60 120L40 120Z', fill: '#CDDDEC' })
    const textPath2 = el('path', { d: 'M80 80L100 80L100 120L80 120Z', fill: '#EFF4F9' })
    const root = svgRoot({ viewBox: '0 0 200 200' }, [bgPath, textPath1, textPath2])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#002D72')
    expect(childCount(root)).toBe(2) // only text paths remain
  })

  it('does NOT trigger when no near-white foreground content exists', () => {
    // Large dark path but foreground is mid-tone (not near-white)
    const bgPath = el('path', {
      d: 'M0 0 C66 0 132 0 200 0 C200 66 200 132 200 200 C132 200 66 200 0 200 C0 132 0 66 0 0Z',
      fill: '#002D72'
    })
    const fgPath = el('path', { d: 'M40 80L60 120', fill: '#888888' })
    const root = svgRoot({ viewBox: '0 0 200 200' }, [bgPath, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(false)
  })

  it('does NOT trigger when remaining paths include colored (non-white) shapes (Aihubmix pattern)', () => {
    // Aihubmix: blue circle (#006FFB) as the icon shape, white cutout (#FDFEFE), blue smile (#006FFB)
    // The blue circle should NOT be removed — it IS the icon, not a background
    const circlePath = el('path', {
      d: 'M0 0 C66 0 132 0 200 0 C200 66 200 132 200 200 C132 200 66 200 0 200 C0 132 0 66 0 0Z',
      fill: '#006FFB'
    })
    const whiteCutout = el('path', { d: 'M40 60L80 60L80 120L40 120Z', fill: '#FDFEFE' })
    const blueSmile = el('path', { d: 'M60 150L140 150L100 180Z', fill: '#006FFB' })
    const root = svgRoot({ viewBox: '0 0 200 200' }, [circlePath, whiteCutout, blueSmile])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(false)
    expect(childCount(root)).toBe(3) // all paths preserved
  })

  it('does NOT trigger when first path is light-colored', () => {
    // First path is near-white itself — not a dark background
    const lightPath = el('path', {
      d: 'M0 0H200V200H0Z',
      fill: '#F0F0F0'
    })
    const darkPath = el('path', { d: 'M40 80L60 120', fill: '#DDDDDD' })
    const root = svgRoot({ viewBox: '0 0 200 200' }, [lightPath, darkPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    // Rule 3c should not fire because first path is near-white
    // Rule 4 might fire for white bg — check that 3c specifically didn't set a fill
    expect(bg.getBackgroundFill()).toBeNull()
  })
})

// ─── Rule 4: Large white background path ─────────────────────────────

describe('Rule 4: large white background path', () => {
  it('removes simple white path covering >= 60% viewBox', () => {
    const whiteBg = el('path', { d: 'M0 0H24V24H0V0Z', fill: 'white' })
    const fgPath = el('path', { d: 'M6 8L18 16', fill: '#333333' })
    const root = svgRoot({}, [whiteBg, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBeNull() // white backgrounds don't set colorPrimary
  })
})

// ─── detectOnly mode ─────────────────────────────────────────────────

describe('detectOnly mode', () => {
  it('detects background fill without removing elements (used for color.tsx)', () => {
    const bgRect = el('rect', { width: '24', height: '24', fill: '#F54F35' })
    const fgPath = el('path', { d: 'M15 5L10 20', fill: '#FEFBFB' })
    const root = svgRoot({}, [bgRect, fgPath])

    const bg = createRemoveBackgroundPlugin({ detectOnly: true })
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#F54F35')
    // Elements should NOT be removed
    expect(childCount(root)).toBe(2)
  })

  it('detects gradient fill in detectOnly mode (Gemini pattern)', () => {
    const grad = el('linearGradient', { id: 'grad1' }, [
      el('stop', { offset: '0.193', 'stop-color': '#1C7DFF' }),
      el('stop', { offset: '1', 'stop-color': '#F0DCD6' })
    ])
    const defs = el('defs', {}, [grad])
    const bgPath = el('path', {
      d: 'M18 0H6C2.68629 0 0 2.68629 0 6V18C0 21.3137 2.68629 24 6 24H18C21.3137 24 24 21.3137 24 18V6C24 2.68629 21.3137 0 18 0Z',
      fill: 'url(#grad1)'
    })
    const fgPath = el('path', { d: 'M12 4L20 12L4 12Z', fill: '#fff' })
    const root = svgRoot({}, [defs, bgPath, fgPath])

    const bg = createRemoveBackgroundPlugin({ detectOnly: true })
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(true)
    expect(bg.getBackgroundFill()).toBe('#1C7DFF')
    // All elements preserved
    expect(childCount(root)).toBe(3)
  })
})

// ─── Element collection: skip mask/clipPath/defs ─────────────────────

describe('skips non-visual elements', () => {
  it('does NOT treat paths inside <mask> as background candidates (AwsBedrock fix)', () => {
    // A <mask> containing a full-viewBox white rect should not trigger Rule 2
    const maskRect = el('path', {
      d: 'M24 0H0V24H24V0Z',
      fill: 'white'
    })
    const mask = el('mask', { id: 'mask0' }, [maskRect])
    const fgPath = el('path', { d: 'M6 8L18 16', fill: '#333' })
    const root = svgRoot({}, [mask, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(false)
  })

  it('does NOT treat paths inside <clipPath> as background candidates', () => {
    const clipRect = el('path', { d: 'M0 0H24V24H0Z', fill: 'white' })
    const clip = el('clipPath', { id: 'clip0' }, [clipRect])
    const defs = el('defs', {}, [clip])
    const fgPath = el('path', { d: 'M6 8L18 16', fill: '#333' })
    const root = svgRoot({}, [defs, fgPath])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(false)
  })
})

// ─── Preserves non-background elements ───────────────────────────────

describe('preserves non-background elements', () => {
  it('keeps colored shapes that are NOT the background (302ai circles)', () => {
    // 302ai has purple circles that ARE the mark — they're not full-viewBox
    const circle1 = el('path', { d: 'M8 8L10 10', fill: '#3F3FAA' })
    const circle2 = el('path', { d: 'M14 14L16 16', fill: '#3F3FAA' })
    const flower = el('path', { d: 'M12 4L12 20', fill: 'white' })
    const root = svgRoot({}, [circle1, circle2, flower])

    const bg = createRemoveBackgroundPlugin()
    bg.plugin.fn(root)

    expect(bg.wasRemoved()).toBe(false)
    expect(childCount(root)).toBe(3)
  })
})
