import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { ModelPromptPair } from '@shared/data/types/message'
import { createUniqueModelId, type Model } from '@shared/data/types/model'

import { ModelPromptOverrides } from '../ModelPromptOverrides'

const models = [
  { id: createUniqueModelId('one', 'model-a'), providerId: 'one', name: 'Model A' },
  { id: createUniqueModelId('two', 'model-b'), providerId: 'two', name: 'Model B' }
] as Model[]
function Harness() {
  const [value, setValue] = useState<ModelPromptPair[]>([])
  const [selected, setSelected] = useState(models)
  return (
    <>
      <ModelPromptOverrides models={selected} value={value} onChange={setValue} />
      <button type="button" onClick={() => setSelected([...selected].reverse())}>
        Reverse
      </button>
      <output>{JSON.stringify(value)}</output>
    </>
  )
}

describe('ModelPromptOverrides', () => {
  it('keeps independent prompts bound to model IDs after selection order changes and clears only one override', () => {
    render(<Harness />)
    const checks = screen.getAllByRole('checkbox', { hidden: true })
    fireEvent.click(checks[0])
    fireEvent.click(checks[1])
    fireEvent.change(screen.getByRole('textbox', { name: /Model A:/, hidden: true }), {
      target: { value: 'Explain for A' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: /Model B:/, hidden: true }), {
      target: { value: 'Explain for B' }
    })
    fireEvent.click(screen.getByText('Reverse'))
    expect((screen.getByRole('textbox', { name: /Model A:/, hidden: true }) as HTMLTextAreaElement).value).toBe(
      'Explain for A'
    )
    expect((screen.getByRole('textbox', { name: /Model B:/, hidden: true }) as HTMLTextAreaElement).value).toBe(
      'Explain for B'
    )
    fireEvent.click(screen.getAllByRole('checkbox', { hidden: true })[0])
    expect(screen.queryByRole('textbox', { name: /Model B:/, hidden: true })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Explain for A')
    expect(screen.getByRole('status').textContent).not.toContain('Explain for B')
  })
})
