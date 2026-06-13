import { describe, expect, it } from 'vitest'

import { settingsWindowFormControlTextClassName } from '../classNames'

describe('settings window class names', () => {
  it('keeps default form control text stable below the md breakpoint', () => {
    expect(settingsWindowFormControlTextClassName).toContain('[&_[data-slot=input].text-base]:text-sm')
    expect(settingsWindowFormControlTextClassName).toContain('[&_[data-slot=input-group-control].text-base]:text-sm')
    expect(settingsWindowFormControlTextClassName).toContain('[&_[data-slot=textarea-input].text-lg]:text-sm')
  })
})
