import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BaseConfigItem } from '../../baseConfigItem'
import SizeField from '../SizeField'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

// `imageGenerationToFields` always derives the pair keys from the field key.
const item: BaseConfigItem = {
  type: 'customSize',
  key: 'customSize',
  widthKey: 'customSize_width',
  heightKey: 'customSize_height',
  validation: { minWidth: 512 }
}

function renderSizeField(painting: Record<string, unknown>) {
  const onChange = vi.fn()
  render(
    <SizeField
      item={item}
      fieldKey="customSize"
      painting={painting}
      translate={(key) => key}
      currentValue={painting.customSize}
      onChange={onChange}
    />
  )
  return onChange
}

describe('SizeField', () => {
  // An unset pair is what `canonicalGenerate` turns into "the server picks its
  // own size", so it has to stay reachable: visible as empty, and not quietly
  // turned into a concrete size by touching the field.
  it.each([
    ['unset', {}],
    ['a non-numeric leftover', { customSize_width: 'auto' }]
  ])('shows an empty width field when the size is %s', (_case, painting) => {
    renderSizeField(painting)

    expect(screen.getByLabelText('paintings.generate.width')).toHaveValue('')
  })

  // The pair is two identical fields, so a copied-and-pasted key is the likely
  // slip; nothing else here would catch a height that lands on the width key.
  it.each([
    ['width', 'paintings.generate.width', 'customSize_width'],
    ['height', 'paintings.generate.height', 'customSize_height']
  ])('commits a typed %s to its own key', async (_side, label, key) => {
    const user = userEvent.setup()
    const onChange = renderSizeField({})

    await user.type(screen.getByLabelText(label), '1024')
    await user.tab()

    expect(onChange).toHaveBeenCalledWith({ [key]: 1024 })
  })

  it('writes no size when an empty field is focused and left', async () => {
    const user = userEvent.setup()
    const onChange = renderSizeField({})

    await user.click(screen.getByLabelText('paintings.generate.width'))
    await user.tab()

    expect(onChange).toHaveBeenCalledWith({ customSize_width: undefined })
  })

  it('clears back to unset rather than to an empty string', async () => {
    const user = userEvent.setup()
    const onChange = renderSizeField({ customSize_width: 1024 })

    await user.clear(screen.getByLabelText('paintings.generate.width'))
    await user.tab()

    expect(onChange).toHaveBeenCalledWith({ customSize_width: undefined })
  })
})
