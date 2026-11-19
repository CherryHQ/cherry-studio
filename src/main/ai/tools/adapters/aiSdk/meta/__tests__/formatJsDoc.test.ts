import { describe, expect, it } from 'vitest'

import { schemaToJSDoc } from '../formatJsDoc'

describe('schemaToJSDoc', () => {
  it('keeps valid arguments and boolean schemas while skipping malformed property entries', () => {
    const text = schemaToJSDoc('sample', 'Inspect sample', {
      properties: {
        name: { type: 'string', description: 'Name to inspect' },
        anything: true,
        forbidden: false,
        bad: null,
        list: []
      },
      required: ['name', 42]
    })

    expect(text).toContain('@param {string} params.name - Name to inspect (required)')
    expect(text).toContain('@param {*} [params.anything]')
    expect(text).toContain('@param {*} [params.forbidden]')
    expect(text).not.toContain('params.bad')
    expect(text).not.toContain('params.list')
  })

  it.each([null, 'invalid', [], 1])('ignores an invalid properties container %j', (properties) => {
    const text = schemaToJSDoc('sample', 'Inspect sample', { properties })

    expect(text).toContain('Inspect sample')
    expect(text).toContain('function sample(params) {}')
    expect(text).not.toContain('@param')
  })

  it('validates nested object and item property containers independently', () => {
    const text = schemaToJSDoc('sample', undefined, {
      properties: {
        valid: { type: 'object', properties: { child: { type: 'boolean' } }, required: ['child'] },
        invalid: { type: 'object', properties: 'invalid' },
        items: { type: 'array', items: { type: 'object', properties: { child: { type: 'integer' } } } },
        invalidItems: { type: 'array', items: { type: 'object', properties: ['invalid'] } }
      }
    })

    expect(text).toContain('@param {boolean} params.valid.child - (required)')
    expect(text).toContain('@param {number} [params.items[].child]')
    expect(text).not.toContain('params.invalid.')
    expect(text).not.toContain('params.invalidItems[].')
  })
})
