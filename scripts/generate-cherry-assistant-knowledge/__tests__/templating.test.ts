import { describe, expect, it } from 'vitest'

import { render } from '../templating'

describe('templating.render', () => {
  it('substitutes known placeholders', () => {
    const { output, unresolved } = render('Total {{count}} providers', { count: '63' })
    expect(output).toBe('Total 63 providers')
    expect(unresolved).toEqual([])
  })

  it('reports unresolved placeholders and leaves them in place', () => {
    const { output, unresolved } = render('Hello {{name}} from {{place}}', { name: 'Cherry' })
    expect(output).toBe('Hello Cherry from {{place}}')
    expect(unresolved).toEqual(['place'])
  })

  it('deduplicates unresolved keys when used multiple times', () => {
    const { output, unresolved } = render('{{x}} and {{x}}', {})
    expect(output).toBe('{{x}} and {{x}}')
    expect(unresolved).toEqual(['x'])
  })

  it('tolerates whitespace inside placeholders', () => {
    const { output } = render('{{ greeting }}', { greeting: 'hi' })
    expect(output).toBe('hi')
  })

  it('passes through templates with no placeholders', () => {
    const { output, unresolved } = render('plain markdown', { unused: 'ignored' })
    expect(output).toBe('plain markdown')
    expect(unresolved).toEqual([])
  })
})
