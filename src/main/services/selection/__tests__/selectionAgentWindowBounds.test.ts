import { describe, expect, it } from 'vitest'

import { placeSelectionAgentWindow, resizeSelectionAgentWindow } from '../selectionAgentWindowBounds'

const WORK_AREA = { x: 0, y: 25, width: 1440, height: 875 }
const COMPOSE = { width: 560, height: 160 }
const CONVERSATION = { width: 560, height: 620 }

describe('placeSelectionAgentWindow', () => {
  it('centers the window under the toolbar top edge', () => {
    const toolbar = { x: 400, y: 300, width: 240, height: 40 }

    expect(placeSelectionAgentWindow(COMPOSE, toolbar, WORK_AREA)).toEqual({ x: 240, y: 300, ...COMPOSE })
  })

  it('keeps the window inside the work area when the toolbar sits at its edge', () => {
    const toolbar = { x: 1300, y: 860, width: 140, height: 40 }

    expect(placeSelectionAgentWindow(COMPOSE, toolbar, WORK_AREA)).toEqual({ x: 874, y: 734, ...COMPOSE })
  })

  it('centers on the work area without a toolbar to follow', () => {
    expect(placeSelectionAgentWindow(CONVERSATION, null, WORK_AREA)).toEqual({ x: 440, y: 153, ...CONVERSATION })
  })
})

describe('resizeSelectionAgentWindow', () => {
  it('grows downward from the compose bar when the space below is enough', () => {
    const compose = { x: 240, y: 100, ...COMPOSE }

    expect(resizeSelectionAgentWindow(compose, CONVERSATION, WORK_AREA)).toEqual({ x: 240, y: 100, ...CONVERSATION })
  })

  it('keeps the bottom edge and grows upward when the space below runs out', () => {
    const compose = { x: 240, y: 600, ...COMPOSE }

    expect(resizeSelectionAgentWindow(compose, CONVERSATION, WORK_AREA)).toEqual({ x: 240, y: 140, ...CONVERSATION })
  })

  it('shrinks to the work area on a display shorter than the conversation window', () => {
    const shortArea = { x: 0, y: 0, width: 1280, height: 600 }
    const compose = { x: 100, y: 200, ...COMPOSE }

    expect(resizeSelectionAgentWindow(compose, CONVERSATION, shortArea)).toEqual({
      x: 100,
      y: 6,
      width: 560,
      height: 588
    })
  })
})
