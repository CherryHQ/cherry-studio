// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserCursorAnimation } from '../BrowserCursorAnimation'

describe('Browser cursor trajectories', () => {
  let time: number
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number
  let position: HTMLDivElement
  let sprite: HTMLImageElement
  let arrivals: Array<{ time: number; point: number[] }>
  let animation: BrowserCursorAnimation
  const point = () => [...position.style.transform.matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]))
  const advance = (milliseconds: number) => {
    time += milliseconds
    vi.advanceTimersByTime(milliseconds)
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(time))
  }
  const run = (milliseconds: number, interval = 1000 / 60) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += interval) advance(interval)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    time = 0
    frames = new Map()
    nextFrame = 0
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    position = document.createElement('div')
    sprite = document.createElement('img')
    arrivals = []
    animation = new BrowserCursorAnimation(position, sprite, () => arrivals.push({ time, point: point() }))
    animation.move(100, 100, 4000, 2000, false, false, false)
    run(300)
    arrivals = []
  })

  afterEach(() => {
    animation.dispose()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each([30, 60, 120, 144])('follows a curved long path and arrives before the 250ms input bound at %iHz', (hz) => {
    const start = time
    animation.move(1500, 100, 4000, 2000, true, false, false)
    advance(1000 / hz)
    expect(arrivals).toEqual([])
    expect(point()[0]).toBeGreaterThan(100)
    expect(point()[0]).toBeLessThan(1500)
    expect(point()[1]).toBeGreaterThan(100)
    run(240, 1000 / hz)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0].point).toEqual([1500, 100])
    expect(arrivals[0].time - start).toBeLessThan(250)
  })

  it('scoots along a short straight path, then restores its shape and stops after bounded idle feedback', () => {
    animation.move(160, 100, 4000, 2000, true, false, false)
    advance(25)
    expect(point()[1]).toBe(100)
    expect(point()[0]).toBeGreaterThan(100)
    expect(sprite.style.transform).not.toContain('scale(1, 1)')
    run(220)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0].point).toEqual([160, 100])
    run(400)
    expect(Number(position.style.opacity)).toBeGreaterThan(0.9)
    run(1600)
    expect(Number(position.style.opacity)).toBe(0)
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retargets from the displayed position without acknowledging an abandoned destination', () => {
    animation.move(1500, 100, 4000, 2000, true, false, false)
    advance(20)
    const interrupted = point()
    animation.move(200, 300, 4000, 2000, true, false, false)
    expect(point()).toEqual(interrupted)
    run(240)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0].point).toEqual([200, 300])
    animation.dispose()
    run(2000)
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(Number(position.style.opacity)).toBe(0)
  })

  it('snaps reduced-motion updates into viewport bounds and cancels an in-flight trajectory on hide', () => {
    animation.move(5000, -20, 800, 600, true, true, false)
    expect(arrivals[0].point).toEqual([800, 0])
    expect(position.style.opacity).toBe('1')
    animation.move(100, 400, 800, 600, true, false, false)
    advance(15)
    animation.hide(true)
    run(2000)
    expect(arrivals).toHaveLength(1)
    expect(position.style.opacity).toBe('0')
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels idle sway and its fade deadline when a new movement begins', () => {
    run(350)
    expect(sprite.style.transform).not.toContain('rotate(-44deg)')
    animation.move(700, 500, 4000, 2000, true, false, false)
    run(650)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0].point).toEqual([700, 500])
    expect(Number(position.style.opacity)).toBeGreaterThan(0.9)
    run(1700)
    expect(position.style.opacity).toBe('0')
    expect(frames.size).toBe(0)
  })

  it('starts a new trajectory from its own timestamp when an older frame was suspended', () => {
    animation.move(1500, 100, 4000, 2000, true, false, false)
    time += 1500
    animation.move(700, 100, 4000, 2000, true, false, false)
    advance(16)
    expect(arrivals).toEqual([])
    expect(point()[0]).toBeGreaterThan(100)
    expect(point()[0]).toBeLessThan(700)
    run(240)
    expect(arrivals[0].point).toEqual([700, 100])
  })

  it('settles safely after a stalled frame instead of integrating unstable positions or duplicate arrival', () => {
    animation.move(3000, 1000, 4000, 2000, true, false, false)
    advance(1500)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0].point).toEqual([3000, 1000])
    expect(sprite.style.transform).not.toMatch(/NaN|Infinity/)
    run(2000)
    expect(arrivals).toHaveLength(1)
    expect(frames.size).toBe(0)
  })
})
