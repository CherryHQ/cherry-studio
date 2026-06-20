import { describe, expect, it } from 'vitest'

import { knowledgeDataSourceCheckboxClassName } from '../styles'

describe('knowledgeDataSourceCheckboxClassName', () => {
  // Regression guard for the data-source checkbox shifting on check: the checkbox is an
  // inline-level box, so without `align-middle` it aligns to its text baseline, and that
  // baseline moves when the check indicator (an SVG) mounts — nudging the box up/down in
  // the row. `align-middle` aligns it by its box center instead, independent of the
  // indicator. Removing it reintroduces the shift, so pin its presence here.
  it('aligns the checkbox by its box center so it stays put across checked states', () => {
    expect(knowledgeDataSourceCheckboxClassName).toContain('align-middle')
  })

  it('centers the check indicator within the box', () => {
    expect(knowledgeDataSourceCheckboxClassName).toContain('inline-flex')
    expect(knowledgeDataSourceCheckboxClassName).toContain('items-center')
    expect(knowledgeDataSourceCheckboxClassName).toContain('justify-center')
  })
})
