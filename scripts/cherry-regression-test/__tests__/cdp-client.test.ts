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
      <select aria-label="Model"><option value="chat-model">Chat model</option></select>
    `
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    Element.prototype.scrollIntoView = vi.fn()
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
