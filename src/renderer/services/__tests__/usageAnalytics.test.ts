import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import { type RendererAnalyticsEvent, rendererAnalyticsEventSchema } from '@shared/ipc/schemas/analytics'

import {
  type AnalyticsView,
  attachPageDwellTracker,
  installUiClickTracker,
  PageDwellTracker,
  setUsageAnalyticsPage,
  toAnalyticsPage
} from '../usageAnalytics'

type PageViewedEvent = Extract<RendererAnalyticsEvent, { event: 'page_viewed' }>
type UiClickedEvent = Extract<RendererAnalyticsEvent, { event: 'ui_clicked' }>

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const chat: AnalyticsView = { key: 'tab-1', page: 'chat' }
const settings: AnalyticsView = { key: 'tab-2', page: 'settings', subpage: 'provider' }

function createTracker(state = { focused: true, visible: true }) {
  let time = 0
  const events: PageViewedEvent[] = []
  const tracker = new PageDwellTracker(
    (event) => events.push(event),
    () => time,
    state
  )
  return {
    tracker,
    events,
    advance: (ms: number) => {
      time += ms
    }
  }
}

describe('toAnalyticsPage', () => {
  it('drops conversation ids and query strings from chat routes', () => {
    expect(toAnalyticsPage({ type: 'route', url: '/app/chat/3f2a1b6c-7d8e-4f90-a1b2-c3d4e5f6a7b8?q=secret' })).toEqual({
      page: 'chat'
    })
  })

  it('reports a custom mini app without its id but keeps a built-in one', () => {
    expect(toAnalyticsPage({ type: 'route', url: '/app/mini-app/my-private-app' })).toEqual({ page: 'mini_app' })
    expect(toAnalyticsPage({ type: 'route', url: '/app/mini-app/openai' })).toEqual({
      page: 'mini_app',
      subpage: 'openai'
    })
  })

  it('keeps only the static settings section, never the id below it', () => {
    expect(toAnalyticsPage({ type: 'route', url: '/settings/provider/my-provider-id' })).toEqual({
      page: 'settings',
      subpage: 'provider'
    })
    expect(toAnalyticsPage({ type: 'route', url: '/settings/User_Data' })).toEqual({ page: 'settings' })
  })

  it('never reports the address of a webview tab', () => {
    expect(toAnalyticsPage({ type: 'webview', url: 'https://example.com/private/path' })).toEqual({ page: 'webview' })
  })

  it('maps unknown or malformed routes to other', () => {
    expect(toAnalyticsPage({ type: 'route', url: '/app/unknown-page/x' })).toEqual({ page: 'other' })
    expect(toAnalyticsPage({ type: 'route', url: '/somewhere/else' })).toEqual({ page: 'other' })
    expect(toAnalyticsPage({ type: 'route', url: 'http://[::1' })).toEqual({ page: 'other' })
  })

  it('produces a page_viewed event main accepts for every built-in mini app', () => {
    for (const { id } of PRESETS_MINI_APPS) {
      const event = {
        event: 'page_viewed',
        ...toAnalyticsPage({ type: 'route', url: `/app/mini-app/${id}` }),
        durationMs: 5_000,
        activeMs: 5_000,
        endReason: 'navigate',
        capped: false
      }
      expect(rendererAnalyticsEventSchema.safeParse(event).success, id).toBe(true)
    }
  })
})

describe('PageDwellTracker', () => {
  it('reports one page_viewed per visit, however often the same view is shown again', () => {
    const { tracker, events, advance } = createTracker()
    tracker.show(chat, 'navigate')
    advance(2 * SECOND)
    tracker.show({ ...chat }, 'navigate')
    advance(3 * SECOND)
    tracker.show(settings, 'tab_switch')
    advance(4 * SECOND)
    tracker.end('app_quit')

    expect(events).toEqual([
      expect.objectContaining({ page: 'chat', durationMs: 5 * SECOND, endReason: 'tab_switch' }),
      expect.objectContaining({
        page: 'settings',
        subpage: 'provider',
        previousPage: 'chat',
        durationMs: 4 * SECOND,
        endReason: 'app_quit'
      })
    ])
  })

  it('ends the visit when switching between two tabs on the same page', () => {
    const { tracker, events, advance } = createTracker()
    tracker.show(chat, 'navigate')
    advance(2 * SECOND)
    tracker.show({ key: 'tab-3', page: 'chat' }, 'tab_switch')

    expect(events).toEqual([expect.objectContaining({ page: 'chat', durationMs: 2 * SECOND, endReason: 'tab_switch' })])
  })

  it('drops visits shorter than one second', () => {
    const { tracker, events, advance } = createTracker()
    tracker.show(chat, 'navigate')
    advance(999)
    tracker.show(settings, 'navigate')

    expect(events).toEqual([])
  })

  it('counts active time only while focused, visible, and within a minute of input', () => {
    const { tracker, events, advance } = createTracker()
    tracker.show(chat, 'navigate')
    tracker.input()
    advance(2 * MINUTE) // only the first minute after input is active
    tracker.input()
    advance(10 * SECOND)
    tracker.setFocused(false)
    advance(50 * SECOND) // blurred: not active
    tracker.setFocused(true)
    advance(20 * SECOND)
    tracker.end('navigate')

    expect(events[0]).toMatchObject({ durationMs: 200 * SECOND, activeMs: 90 * SECOND })
  })

  it('ends a visit after 30 minutes without input and starts a new one on the next input', () => {
    const { tracker, events, advance } = createTracker()
    tracker.show(chat, 'navigate')
    tracker.input()
    advance(30 * MINUTE - 1)
    tracker.checkIdle()
    expect(events).toEqual([])

    advance(1)
    tracker.checkIdle()
    expect(events).toEqual([
      expect.objectContaining({ page: 'chat', durationMs: 30 * MINUTE, activeMs: MINUTE, endReason: 'idle_timeout' })
    ])

    advance(10 * MINUTE)
    tracker.input()
    advance(2 * SECOND)
    tracker.end('navigate')
    expect(events[1]).toMatchObject({ page: 'chat', durationMs: 2 * SECOND })
  })

  it('caps durations at four hours and marks the visit as capped', () => {
    const { tracker, events, advance } = createTracker()
    tracker.show(chat, 'navigate')
    for (let elapsed = 0; elapsed < 5 * HOUR; elapsed += 30 * SECOND) {
      tracker.input()
      advance(30 * SECOND)
    }
    tracker.end('navigate')

    expect(events[0]).toMatchObject({ durationMs: 4 * HOUR, activeMs: 4 * HOUR, capped: true })
  })

  it('ends the visit when the window is hidden and never times the hidden period', () => {
    const { tracker, events, advance } = createTracker()
    tracker.show(chat, 'navigate')
    advance(3 * SECOND)
    tracker.setVisible(false)
    expect(events).toEqual([
      expect.objectContaining({ page: 'chat', durationMs: 3 * SECOND, endReason: 'window_hidden' })
    ])

    tracker.show(settings, 'tab_switch')
    advance(10 * MINUTE)
    tracker.setVisible(true)
    advance(2 * SECOND)
    tracker.end('app_quit')

    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ page: 'settings', durationMs: 2 * SECOND })
  })

  it('does not start timing a window that opens hidden until it becomes visible', () => {
    const { tracker, events, advance } = createTracker({ focused: false, visible: false })
    tracker.show(chat, 'navigate')
    advance(5 * MINUTE)
    tracker.setVisible(true)
    advance(2 * SECOND)
    tracker.end('app_quit')

    expect(events).toEqual([expect.objectContaining({ durationMs: 2 * SECOND })])
  })
})

describe('attachPageDwellTracker', () => {
  it('ends the visit with window_hidden when the document becomes hidden', () => {
    const { tracker, events, advance } = createTracker()
    const detach = attachPageDwellTracker(tracker)
    tracker.show(chat, 'navigate')
    advance(3 * SECOND)

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    visibility.mockRestore()
    detach()

    expect(events).toEqual([expect.objectContaining({ page: 'chat', endReason: 'window_hidden' })])
  })
})

describe('installUiClickTracker', () => {
  let clicks: UiClickedEvent[]
  let uninstall: () => void

  function mount(html: string): void {
    document.body.innerHTML = html
  }

  function click(selector: string, detail = 1): void {
    document
      .querySelector(selector)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }))
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    clicks = []
    setUsageAnalyticsPage('other')
    uninstall = installUiClickTracker(document, (event) => clicks.push(event))
  })

  afterEach(() => {
    uninstall()
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('reports the nearest role token rather than a part token or an outer one', () => {
    mount(`
      <section data-ui="chat.page">
        <div data-ui="part:toolbar chat.composer.send">
          <button id="send"><svg id="icon"></svg></button>
        </div>
      </section>`)

    click('#icon')

    expect(clicks).toEqual([
      { event: 'ui_clicked', ui: 'chat.composer.send', page: 'other', element: 'button', input: 'pointer' }
    ])
  })

  it('names a part-only button by its nearest role ancestor instead of the shared part token', () => {
    mount(`
      <nav data-ui="app.sidebar">
        <button id="entry" data-ui="part:button part:context-menu-trigger"><svg id="icon"></svg></button>
      </nav>
      <div><button id="orphan" data-ui="part:button">x</button></div>`)

    click('#icon')
    vi.advanceTimersByTime(500)
    click('#orphan')

    expect(clicks.map(({ ui }) => ui)).toEqual(['app.sidebar', 'part:button'])
  })

  it('tells sibling controls of one component apart by their analytics names', () => {
    mount(`
      <div data-ui="chat.message-menu-bar">
        <button id="copy" data-ui="part:button" data-analytics="chat.message-menu-bar:copy"><svg id="icon"></svg></button>
        <button id="retry" data-ui="part:button" data-analytics="chat.message-menu-bar:retry">x</button>
      </div>`)

    click('#icon')
    click('#retry')

    expect(clicks.map(({ ui }) => ui)).toEqual(['chat.message-menu-bar:copy', 'chat.message-menu-bar:retry'])
  })

  it('falls back to the data-ui token when the analytics name is invalid or belongs to another control', () => {
    mount(`
      <div data-ui="chat.message"><button id="invalid" data-analytics="Chat Message:Person@Example.com">x</button></div>
      <div role="button" data-analytics="chat.card:open" data-ui="chat.card"><button id="inner">x</button></div>`)

    click('#invalid')
    click('#inner')

    expect(clicks.map(({ ui }) => ui)).toEqual(['chat.message', 'chat.card'])
  })

  it('names a control by an analytics name on a non-control wrapper it renders inside', () => {
    mount('<span data-analytics="settings.general:theme"><button id="c">x</button></span>')

    click('#c')

    expect(clicks.map(({ ui }) => ui)).toEqual(['settings.general:theme'])
  })

  it.each([
    ['<div id="c" role="radio" data-ui="t9">x</div>', 'input'],
    ['<button id="c" data-ui="t1">x</button>', 'button'],
    ['<a id="c" data-ui="t2">x</a>', 'link'],
    ['<div id="c" role="menuitem" data-ui="t3">x</div>', 'menuitem'],
    ['<div id="c" role="tab" data-ui="t4">x</div>', 'tab'],
    ['<div id="c" role="switch" data-ui="t5">x</div>', 'switch'],
    ['<div id="c" role="checkbox" data-ui="t6">x</div>', 'checkbox'],
    ['<div id="c" role="option" data-ui="t7">x</div>', 'option'],
    ['<select id="c" data-ui="t8"></select>', 'input']
  ])('reports clicks on %s as %s', (html, element) => {
    mount(html)
    click('#c')
    expect(clicks).toEqual([expect.objectContaining({ element })])
  })

  it('reports unlabeled for a control without a data-ui ancestor or with a non-static token', () => {
    mount(`
      <button id="bare">Bare</button>
      <div data-ui="Person@Example.com"><button id="dynamic">Dynamic</button></div>`)

    click('#bare')
    vi.advanceTimersByTime(500)
    click('#dynamic')

    expect(clicks.map(({ ui }) => ui)).toEqual(['unlabeled', 'unlabeled'])
  })

  it('never reports the text, value, or link of the clicked control', () => {
    const preventNavigation = (event: Event) => event.preventDefault()
    document.addEventListener('click', preventNavigation)
    onTestFinished(() => document.removeEventListener('click', preventNavigation))
    mount(`
      <a id="link" href="https://secret.example/private" data-ui="nav.link">Secret title</a>
      <input id="box" type="checkbox" value="secret-value" data-ui="form.box" />`)

    click('#link')
    click('#box')

    expect(clicks).toHaveLength(2)
    expect(JSON.stringify(clicks)).not.toMatch(/secret/i)
  })

  it('reports repeated clicks on one token within 500 ms once', () => {
    mount('<button id="a" data-ui="a.button">A</button><button id="b" data-ui="b.button">B</button>')

    click('#a')
    vi.advanceTimersByTime(499)
    click('#a')
    click('#b')
    vi.advanceTimersByTime(500)
    click('#b')

    expect(clicks.map(({ ui }) => ui)).toEqual(['a.button', 'b.button', 'b.button'])
  })

  it('tells keyboard activation (detail 0) from pointer clicks', () => {
    mount('<button id="a" data-ui="a.button">A</button>')

    click('#a', 0)
    vi.advanceTimersByTime(500)
    click('#a', 1)

    expect(clicks.map(({ input }) => input)).toEqual(['keyboard', 'pointer'])
  })

  it('ignores clicks on non-interactive elements', () => {
    mount('<div id="card" data-ui="chat.card"><span id="text">Hello</span></div>')

    click('#card')
    click('#text')

    expect(clicks).toEqual([])
  })

  it('attributes clicks to the page set for this window', () => {
    mount('<button id="a" data-ui="a.button">A</button>')

    setUsageAnalyticsPage('settings')
    click('#a')

    expect(clicks).toEqual([expect.objectContaining({ page: 'settings' })])
  })
})
