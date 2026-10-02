import { describe, expect, it } from 'vitest'

import { initialState, overlayReducer } from '../reducer'
import type { OverlayState } from '../types'

describe('overlayReducer', () => {
  describe('idle phase', () => {
    it('starts a zero-size selection at the press point on POINTER_DOWN_BACKGROUND', () => {
      const state = overlayReducer(initialState, { type: 'POINTER_DOWN_BACKGROUND', x: 100, y: 200 })
      expect(state.phase).toBe('selecting')
      expect(state.dragOrigin).toEqual({ x: 100, y: 200 })
      expect(state.selection).toEqual({ x: 100, y: 200, width: 0, height: 0 })
    })

    it('tracks the cursor without leaving idle, which is what feeds the magnifier', () => {
      const state = overlayReducer(initialState, { type: 'POINTER_MOVE', x: 50, y: 60 })
      expect(state.phase).toBe('idle')
      expect(state.pointerPosition).toEqual({ x: 50, y: 60 })
    })

    it('returns the same state object for a stray POINTER_UP, so nothing re-renders', () => {
      const state = overlayReducer(initialState, { type: 'POINTER_UP' })
      expect(state).toBe(initialState)
    })

    it('ignores POINTER_DOWN_SELECTION when there is no selection to grab', () => {
      const state = overlayReducer(initialState, { type: 'POINTER_DOWN_SELECTION', x: 10, y: 10 })
      expect(state).toBe(initialState)
    })
  })

  describe('selecting phase', () => {
    const selectingState: OverlayState = {
      ...initialState,
      phase: 'selecting',
      dragOrigin: { x: 100, y: 100 },
      selection: { x: 100, y: 100, width: 0, height: 0 }
    }

    it('grows the selection toward the cursor', () => {
      const state = overlayReducer(selectingState, { type: 'POINTER_MOVE', x: 200, y: 250 })
      expect(state.selection).toEqual({ x: 100, y: 100, width: 100, height: 150 })
      expect(state.pointerPosition).toEqual({ x: 200, y: 250 })
    })

    it('normalizes a reverse drag into a positive-size rect', () => {
      const state = overlayReducer(selectingState, { type: 'POINTER_MOVE', x: 50, y: 50 })
      expect(state.selection).toEqual({ x: 50, y: 50, width: 50, height: 50 })
    })

    it('stops the rect edge at the display edge when dragged past it', () => {
      const state = overlayReducer(selectingState, {
        type: 'POINTER_MOVE',
        x: 1400,
        y: 1200,
        viewportWidth: 1000,
        viewportHeight: 800
      })
      // The rect stops at the viewport, but the pointer is still reported raw so the
      // magnifier keeps following the cursor off-screen.
      expect(state.selection).toEqual({ x: 100, y: 100, width: 900, height: 700 })
      expect(state.pointerPosition).toEqual({ x: 1400, y: 1200 })
    })

    it('commits a selection that cleared the minimum drag distance', () => {
      const withSelection: OverlayState = { ...selectingState, selection: { x: 100, y: 100, width: 50, height: 50 } }
      const state = overlayReducer(withSelection, { type: 'POINTER_UP' })
      expect(state.phase).toBe('selected')
      expect(state.selection).toEqual({ x: 100, y: 100, width: 50, height: 50 })
      expect(state.dragOrigin).toBeNull()
    })

    it('discards a click-sized drag instead of committing a 2px selection', () => {
      const withTinySelection: OverlayState = { ...selectingState, selection: { x: 100, y: 100, width: 2, height: 2 } }
      const state = overlayReducer(withTinySelection, { type: 'POINTER_UP' })
      expect(state.phase).toBe('idle')
      expect(state.selection).toBeNull()
    })

    it('commits at exactly the minimum size', () => {
      const withMinimalSelection: OverlayState = {
        ...selectingState,
        selection: { x: 100, y: 100, width: 3, height: 3 }
      }
      const state = overlayReducer(withMinimalSelection, { type: 'POINTER_UP' })
      expect(state.phase).toBe('selected')
    })
  })

  describe('POINTER_DOWN_WINDOW', () => {
    it('snaps to the window rect from idle', () => {
      const state = overlayReducer(initialState, {
        type: 'POINTER_DOWN_WINDOW',
        x: 150,
        y: 150,
        windowRect: { x: 100, y: 100, width: 800, height: 600 }
      })
      expect(state.phase).toBe('selected')
      expect(state.selection).toEqual({ x: 100, y: 100, width: 800, height: 600 })
      expect(state.dragOrigin).toBeNull()
      expect(state.selectionAtDragStart).toBeNull()
      expect(state.activeHandle).toBeNull()
      expect(state.pointerPosition).toEqual({ x: 150, y: 150 })
    })

    it('replaces an existing selection when another window is clicked', () => {
      const selectedState: OverlayState = {
        ...initialState,
        phase: 'selected',
        selection: { x: 50, y: 50, width: 200, height: 100 }
      }
      const state = overlayReducer(selectedState, {
        type: 'POINTER_DOWN_WINDOW',
        x: 500,
        y: 400,
        windowRect: { x: 300, y: 200, width: 600, height: 400 }
      })
      expect(state.selection).toEqual({ x: 300, y: 200, width: 600, height: 400 })
    })
  })

  describe('selected phase', () => {
    const selectedState: OverlayState = {
      ...initialState,
      phase: 'selected',
      selection: { x: 100, y: 100, width: 200, height: 150 }
    }

    it('starts a new selection when the press lands outside', () => {
      const state = overlayReducer(selectedState, { type: 'POINTER_DOWN_BACKGROUND', x: 500, y: 500 })
      expect(state.phase).toBe('selecting')
      expect(state.dragOrigin).toEqual({ x: 500, y: 500 })
    })

    it('arms a move without leaving the selected phase', () => {
      const state = overlayReducer(selectedState, { type: 'POINTER_DOWN_SELECTION', x: 150, y: 150 })
      // Entering 'moving' here would unmount and remount everything gated on 'selected'
      // — toolbar, property panel, annotation interactivity — on every click.
      expect(state.phase).toBe('selected')
      expect(state.dragOrigin).toEqual({ x: 150, y: 150 })
      expect(state.selectionAtDragStart).toEqual(selectedState.selection)
    })

    it('disarms on release so a later cursor-tracking move cannot teleport the selection', () => {
      const armed = overlayReducer(selectedState, { type: 'POINTER_DOWN_SELECTION', x: 150, y: 150 })
      const released = overlayReducer(armed, { type: 'POINTER_UP' })
      expect(released.phase).toBe('selected')
      expect(released.selection).toEqual(selectedState.selection)
      expect(released.dragOrigin).toBeNull()
      expect(released.selectionAtDragStart).toBeNull()

      const afterStrayMove = overlayReducer(released, { type: 'POINTER_MOVE', x: 900, y: 900 })
      expect(afterStrayMove.phase).toBe('selected')
      expect(afterStrayMove.selection).toEqual(selectedState.selection)
    })

    it('enters moving only on the first real move after the press', () => {
      const armed = overlayReducer(selectedState, { type: 'POINTER_DOWN_SELECTION', x: 150, y: 150 })
      const state = overlayReducer(armed, { type: 'POINTER_MOVE', x: 160, y: 170 })
      expect(state.phase).toBe('moving')
      expect(state.selection).toEqual({ x: 110, y: 120, width: 200, height: 150 })
    })

    it('clamps that first move to the viewport', () => {
      const armed = overlayReducer(selectedState, { type: 'POINTER_DOWN_SELECTION', x: 150, y: 150 })
      const state = overlayReducer(armed, {
        type: 'POINTER_MOVE',
        x: 950,
        y: 750,
        viewportWidth: 1000,
        viewportHeight: 800
      })
      expect(state.phase).toBe('moving')
      expect(state.selection).toEqual({
        x: 800, // viewportWidth - selection width
        y: 650, // viewportHeight - selection height
        width: 200,
        height: 150
      })
    })

    it('tracks the cursor without touching the selection while unarmed', () => {
      const state = overlayReducer(selectedState, { type: 'POINTER_MOVE', x: 400, y: 400 })
      expect(state.phase).toBe('selected')
      expect(state.selection).toEqual(selectedState.selection)
      expect(state.pointerPosition).toEqual({ x: 400, y: 400 })
    })
  })

  describe('moving phase', () => {
    const movingState: OverlayState = {
      ...initialState,
      phase: 'moving',
      selection: { x: 100, y: 100, width: 200, height: 150 },
      dragOrigin: { x: 150, y: 150 },
      selectionAtDragStart: { x: 100, y: 100, width: 200, height: 150 }
    }

    it('translates the selection by the pointer delta', () => {
      const state = overlayReducer(movingState, { type: 'POINTER_MOVE', x: 200, y: 180 })
      expect(state.selection).toEqual({ x: 150, y: 130, width: 200, height: 150 })
    })

    it.each([
      ['left', { x: 0, y: 150 }, { x: 0, y: 100 }],
      ['top', { x: 150, y: 0 }, { x: 100, y: 0 }],
      ['right', { x: 950, y: 150 }, { x: 800, y: 100 }],
      ['bottom', { x: 150, y: 800 }, { x: 100, y: 650 }],
      ['top-left corner', { x: -100, y: -100 }, { x: 0, y: 0 }],
      ['bottom-right corner', { x: 1200, y: 1000 }, { x: 800, y: 650 }]
    ])('clamps to the %s edge without shrinking the selection', (_name, pointer, expected) => {
      const state = overlayReducer(movingState, {
        type: 'POINTER_MOVE',
        ...pointer,
        viewportWidth: 1000,
        viewportHeight: 800
      })
      expect(state.selection).toEqual({ ...expected, width: 200, height: 150 })
    })

    it('returns to the exact starting position after a drag far off-screen and back', () => {
      // The delta is taken from the RAW pointer and only the result is clamped. Clamping
      // the input instead would truncate the excursion and leave the rect offset by it.
      const excursion = overlayReducer(movingState, {
        type: 'POINTER_MOVE',
        x: -4000,
        y: -3000,
        viewportWidth: 1000,
        viewportHeight: 800
      })
      const back = overlayReducer(excursion, {
        type: 'POINTER_MOVE',
        x: 150,
        y: 150,
        viewportWidth: 1000,
        viewportHeight: 800
      })
      expect(back.selection).toEqual(movingState.selectionAtDragStart)
    })

    it('leaves the position unclamped when no viewport is supplied', () => {
      const state = overlayReducer(movingState, { type: 'POINTER_MOVE', x: 1200, y: 1000 })
      expect(state.selection).toEqual({ x: 1150, y: 950, width: 200, height: 150 })
    })

    it('settles back into selected on release', () => {
      const state = overlayReducer(movingState, { type: 'POINTER_UP' })
      expect(state.phase).toBe('selected')
      expect(state.dragOrigin).toBeNull()
      expect(state.selectionAtDragStart).toBeNull()
    })
  })

  describe('resizing phase', () => {
    const resizingState: OverlayState = {
      ...initialState,
      phase: 'resizing',
      selection: { x: 100, y: 100, width: 200, height: 150 },
      dragOrigin: { x: 300, y: 250 },
      selectionAtDragStart: { x: 100, y: 100, width: 200, height: 150 },
      activeHandle: 'se'
    }

    it.each([
      ['se', { x: 350, y: 300 }, { x: 100, y: 100, width: 250, height: 200 }],
      ['nw', { x: 50, y: 50 }, { x: 50, y: 50, width: 250, height: 200 }],
      ['ne', { x: 350, y: 50 }, { x: 100, y: 50, width: 250, height: 200 }],
      ['sw', { x: 50, y: 300 }, { x: 50, y: 100, width: 250, height: 200 }],
      // Edge handles constrain one axis only; the other keeps its snapshot value.
      ['n', { x: 200, y: 50 }, { x: 100, y: 50, width: 200, height: 200 }],
      ['w', { x: 50, y: 200 }, { x: 50, y: 100, width: 250, height: 150 }]
    ] as const)('resizes from the %s handle', (handle, pointer, expected) => {
      const state = overlayReducer({ ...resizingState, activeHandle: handle }, { type: 'POINTER_MOVE', ...pointer })
      expect(state.selection).toEqual(expected)
    })

    it('flips the rect when a handle is dragged past the anchored edge', () => {
      // Dragging 'w' past the right edge must mirror the rect around that edge rather
      // than collapse it, and the anchor becomes the rect's new left side.
      const wState: OverlayState = { ...resizingState, activeHandle: 'w' }
      const state = overlayReducer(wState, { type: 'POINTER_MOVE', x: 500, y: 200 })
      expect(state.selection).toEqual({ x: 300, y: 100, width: 200, height: 150 })
    })

    it('never lets a resize reach zero width, which would break every downstream canvas', () => {
      const wState: OverlayState = { ...resizingState, activeHandle: 'w' }
      const state = overlayReducer(wState, { type: 'POINTER_MOVE', x: 300, y: 200 })
      expect(state.selection?.width).toBeGreaterThanOrEqual(1)
    })

    it('resizes from the drag-start snapshot, not from the previous frame', () => {
      const state = overlayReducer(
        { ...resizingState, activeHandle: 'w', selection: { x: 100, y: 100, width: 400, height: 150 } },
        { type: 'POINTER_MOVE', x: 150, y: 200 }
      )
      // Anchored on the snapshot's right edge (300), not the live selection's (500).
      // Feeding the previous result back in is what makes a long drag creep.
      expect(state.selection).toEqual({ x: 150, y: 100, width: 150, height: 150 })
    })

    it('stops the rect edge at the display edge', () => {
      const state = overlayReducer(resizingState, {
        type: 'POINTER_MOVE',
        x: 1400,
        y: 1200,
        viewportWidth: 1000,
        viewportHeight: 800
      })
      expect(state.selection).toEqual({ x: 100, y: 100, width: 900, height: 700 })
    })

    it('settles back into selected and drops the handle on release', () => {
      const state = overlayReducer(resizingState, { type: 'POINTER_UP' })
      expect(state.phase).toBe('selected')
      expect(state.activeHandle).toBeNull()
    })
  })

  describe('RESET', () => {
    it('clears every field from a fully populated state', () => {
      const complexState: OverlayState = {
        phase: 'moving',
        selection: { x: 50, y: 50, width: 300, height: 200 },
        dragOrigin: { x: 100, y: 100 },
        selectionAtDragStart: { x: 50, y: 50, width: 300, height: 200 },
        activeHandle: null,
        pointerPosition: { x: 150, y: 150 }
      }
      expect(overlayReducer(complexState, { type: 'RESET' })).toEqual(initialState)
    })
  })
})
