import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettingsSearchDomIdsProvider, useSettingsSearchDomIds } from '../SettingsSearchDomIds'

const IdsProbe = ({ label }: { label: string }) => {
  const { listboxId, optionDomId } = useSettingsSearchDomIds()
  return <div data-label={label} data-listbox={listboxId} data-option={optionDomId(0)} />
}

const attrOf = (label: string, name: string) => document.querySelector(`[data-label="${label}"]`)?.getAttribute(name)

describe('SettingsSearchDomIds', () => {
  it('derives distinct ids per provider instance (two settings tabs coexist)', () => {
    render(
      <>
        <SettingsSearchDomIdsProvider>
          <IdsProbe label="a" />
        </SettingsSearchDomIdsProvider>
        <SettingsSearchDomIdsProvider>
          <IdsProbe label="b" />
        </SettingsSearchDomIdsProvider>
      </>
    )

    // Duplicate ids across coexisting tabs break aria IDREF uniqueness
    expect(attrOf('a', 'data-listbox')).not.toBe(attrOf('b', 'data-listbox'))
    expect(attrOf('a', 'data-option')).not.toBe(attrOf('b', 'data-option'))
  })

  it('falls back to stable standalone ids outside a provider', () => {
    render(<IdsProbe label="solo" />)

    expect(attrOf('solo', 'data-listbox')).toBe('settings-search-results-listbox')
    expect(attrOf('solo', 'data-option')).toBe('settings-search-option-0')
  })
})
