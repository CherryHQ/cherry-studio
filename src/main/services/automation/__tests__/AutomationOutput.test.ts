import { describe, expect, it } from 'vitest'

import { AutomationOutput } from '../AutomationOutput'

describe('automation observations', () => {
  it('keeps the final screenshot and identifies older images omitted by the budget', () => {
    const output = new AutomationOutput()
    for (let i = 1; i <= 6; i++)
      output.add({ id: `state-${i}`, text: String(i) }, [{ data: `image-${i}`, mimeType: 'image/png' }])
    const content = output.content()
    expect(content.filter((part) => part.type === 'image').map((part) => part.data)).toEqual([
      'image-3',
      'image-4',
      'image-5',
      'image-6'
    ])
    const text = content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    expect(text).toContain('Images for observation state-1 were OMITTED')
    expect(text).toContain('Images for observation state-2 were OMITTED')
    expect(text).not.toContain('Images for observation state-6 were OMITTED')
    const finalLabel = content.findIndex((part) => part.type === 'text' && part.text.startsWith('OBSERVATION state-6'))
    expect(content[finalLabel + 1]).toEqual({
      type: 'image',
      data: 'image-6',
      mimeType: 'image/png',
      annotations: { audience: ['assistant'] }
    })
    expect(content.filter((part) => !part.annotations?.audience.includes('assistant'))).toEqual([])
  })

  it('keeps screenshot observations model-only without hiding ordinary output or capture errors', () => {
    const output = new AutomationOutput()
    output.add({ id: 'screenshot', operation: 'getScreenshot', images: [{ index: 0 }] }, [
      { data: 'image', mimeType: 'image/png' }
    ])
    output.add({ id: 'state', text: 'Calculator displays 649' })
    output.add({ error: { code: 'PERMISSION_REQUIRED', message: 'Screen Recording permission required' } })

    const visibleText = output
      .content()
      .filter((part) => !part.annotations?.audience.includes('assistant'))
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(visibleText).not.toContain('screenshot')
    expect(visibleText).toContain('Calculator displays 649')
    expect(visibleText).toContain('Screen Recording permission required')
  })

  it('does not silently turn a large incomplete observation into apparent success', () => {
    const output = new AutomationOutput()
    output.add({ id: 'oversized', text: 'x'.repeat(48_001) })
    output.add({ id: 'final', text: '649' })
    const text = output
      .content()
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    expect(text).toContain('no complete state was delivered')
    expect(text).toContain('649')
    expect(text).not.toContain('x'.repeat(100))
  })
})
