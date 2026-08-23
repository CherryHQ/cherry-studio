// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { classifyCdpTarget, runDomOperation } from '../cdp-client'

interface Observation {
  ariaSnapshot: string
  count: number
  text: string
  visible: boolean
}

describe('direct CDP DOM operations', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button>Save provider</button>
      <label for="api-key">API key</label>
      <input id="api-key" type="password" />
      <label><input id="enabled" type="checkbox" /> Enabled</label>
      <button id="custom-enabled" role="checkbox" aria-checked="false">Custom enabled</button>
      <select aria-label="Model"><option value="chat-model">Chat model</option></select>
    `
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    Element.prototype.scrollIntoView = vi.fn()
    document.querySelector('#custom-enabled')?.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLElement
      target.setAttribute('aria-checked', String(target.getAttribute('aria-checked') !== 'true'))
    })
  })

  it('finds visible controls by accessible role and name', () => {
    const observation = runDomOperation({
      descriptor: { exact: true, name: 'Save provider', role: 'button' },
      operation: 'inspect'
    }) as Observation

    expect(observation).toMatchObject({ count: 1, text: 'Save provider', visible: true })
    expect(observation.ariaSnapshot).toContain('button "Save provider"')
  })

  it('updates form controls through label and role locators', () => {
    const input = document.querySelector<HTMLInputElement>('#api-key')!
    const inputEvent = vi.fn()
    input.addEventListener('input', inputEvent)

    runDomOperation({ descriptor: { exact: true, label: 'API key' }, operation: 'fill', value: 'configured-key' })
    runDomOperation({ descriptor: { css: '#enabled' }, operation: 'check' })
    runDomOperation({
      descriptor: { exact: true, name: 'Model', role: 'combobox' },
      operation: 'select',
      value: 'chat-model'
    })

    expect(input.value).toBe('configured-key')
    expect(inputEvent).toHaveBeenCalledOnce()
    expect(document.querySelector<HTMLInputElement>('#enabled')?.checked).toBe(true)
    expect(document.querySelector<HTMLSelectElement>('select')?.value).toBe('chat-model')
  })

  it('toggles ARIA checkbox controls used by custom settings components', () => {
    const checkbox = document.querySelector<HTMLElement>('#custom-enabled')!

    runDomOperation({ descriptor: { exact: true, name: 'Custom enabled', role: 'checkbox' }, operation: 'check' })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')

    runDomOperation({ descriptor: { exact: true, name: 'Custom enabled', role: 'checkbox' }, operation: 'uncheck' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })

  it('combines role or CSS selectors with visible text', () => {
    document.body.innerHTML = `
      <button>Avatar</button>
      <button><span>Settings</span></button>
      <button aria-label="Open global search"><svg></svg></button>
      <button>Help</button>
    `

    const byRoleAndText = runDomOperation({
      descriptor: { exact: true, role: 'button', text: 'Settings' },
      operation: 'inspect'
    }) as Observation
    const byCssAndText = runDomOperation({
      descriptor: { css: 'button', exact: true, text: 'Settings' },
      operation: 'inspect'
    }) as Observation
    const byLabel = runDomOperation({
      descriptor: { exact: true, label: 'Settings' },
      operation: 'inspect'
    }) as Observation
    const ariaOnlyByRoleAndText = runDomOperation({
      descriptor: { exact: true, role: 'button', text: 'Open global search' },
      operation: 'inspect'
    }) as Observation

    expect(byRoleAndText).toMatchObject({ count: 1, text: 'Settings', visible: true })
    expect(byCssAndText).toMatchObject({ count: 1, text: 'Settings', visible: true })
    expect(byLabel).toMatchObject({ count: 1, text: 'Settings', visible: true })
    expect(ariaOnlyByRoleAndText).toMatchObject({ count: 1, text: '', visible: true })
  })

  it('excludes script and style source from visible text', () => {
    document.body.innerHTML = `
      <script>MINI_APP_SOURCE_ONLY</script>
      <style>.MINI_APP_STYLE_ONLY { display: block; }</style>
      <main>Ready</main>
    `

    const body = runDomOperation({ descriptor: { css: 'body' }, operation: 'inspect' }) as Observation
    const source = runDomOperation({
      descriptor: { text: 'MINI_APP_SOURCE_ONLY' },
      operation: 'inspect'
    }) as Observation

    expect(body.text).toBe('Ready')
    expect(source).toMatchObject({ count: 0, text: '', visible: false })
  })
})

describe('CDP target classification', () => {
  it.each([
    ['http://localhost:5173/windows/main/index.html', 'main'],
    ['http://localhost:5173/windows/quickAssistant/index.html', 'quick-assistant'],
    ['http://localhost:5173/windows/selection/index.html', 'selection-assistant'],
    ['http://localhost:5173/windows/subWindow/index.html', 'other']
  ])('classifies %s as %s', (url, expected) => {
    expect(classifyCdpTarget(url)).toBe(expected)
  })
})
