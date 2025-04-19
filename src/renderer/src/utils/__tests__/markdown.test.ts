import { describe, expect, it } from 'vitest'

import { findCitationInChildren, MARKDOWN_ALLOWED_TAGS, sanitizeSchema } from '../markdown'

describe('markdown', () => {
  describe('findCitationInChildren', () => {
    it('returns null when children is null or undefined', () => {
      expect(findCitationInChildren(null)).toBeNull()
      expect(findCitationInChildren(undefined)).toBeNull()
    })

    it('finds citation in direct child element', () => {
      const children = [{ props: { 'data-citation': 'test-citation' } }]
      expect(findCitationInChildren(children)).toBe('test-citation')
    })

    it('finds citation in nested child element', () => {
      const children = [
        {
          props: {
            children: [{ props: { 'data-citation': 'nested-citation' } }]
          }
        }
      ]
      expect(findCitationInChildren(children)).toBe('nested-citation')
    })

    it('returns null when no citation is found', () => {
      const children = [{ props: { foo: 'bar' } }, { props: { children: [{ props: { baz: 'qux' } }] } }]
      expect(findCitationInChildren(children)).toBeNull()
    })

    it('handles single child object (non-array)', () => {
      const child = { props: { 'data-citation': 'single-citation' } }
      expect(findCitationInChildren(child)).toBe('single-citation')
    })

    it('handles deeply nested structures', () => {
      const children = [
        {
          props: {
            children: [
              {
                props: {
                  children: [
                    {
                      props: {
                        children: {
                          props: { 'data-citation': 'deep-citation' }
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
      expect(findCitationInChildren(children)).toBe('deep-citation')
    })

    it('handles non-object children gracefully', () => {
      const children = ['text node', 123, { props: { 'data-citation': 'mixed-citation' } }]
      expect(findCitationInChildren(children)).toBe('mixed-citation')
    })
  })

  describe('markdown configuration constants', () => {
    it('MARKDOWN_ALLOWED_TAGS contains expected tags', () => {
      expect(MARKDOWN_ALLOWED_TAGS).toContain('p')
      expect(MARKDOWN_ALLOWED_TAGS).toContain('div')
      expect(MARKDOWN_ALLOWED_TAGS).toContain('code')
      expect(MARKDOWN_ALLOWED_TAGS).toContain('svg')
      expect(MARKDOWN_ALLOWED_TAGS.length).toBeGreaterThan(10)
    })

    it('sanitizeSchema contains proper configuration', () => {
      expect(sanitizeSchema.tagNames).toBe(MARKDOWN_ALLOWED_TAGS)
      expect(sanitizeSchema.attributes).toHaveProperty('*')
      expect(sanitizeSchema.attributes).toHaveProperty('svg')
      expect(sanitizeSchema.attributes).toHaveProperty('a')
    })

    it('sanitizeSchema matches snapshot', () => {
      expect(sanitizeSchema).toMatchSnapshot()
    })
  })
})
