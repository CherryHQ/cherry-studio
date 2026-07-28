import { SearchInput } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof SearchInput> = {
  title: 'Components/Composites/search-input',
  component: SearchInput,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A search field built on `InputGroup`: a leading search icon, a text input, and an optional trailing clear button. Controlled via `value` / `onChange`; pass `onClear` to enable the clear button.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' }
  }
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: function DefaultExample() {
    const [value, setValue] = useState('')
    return (
      <div className="w-80">
        <SearchInput
          value={value}
          placeholder="Search"
          onChange={(e) => setValue(e.target.value)}
          onClear={() => setValue('')}
          clearLabel="Clear search"
        />
      </div>
    )
  }
}

export const WithoutClearButton: Story = {
  render: function NoClearExample() {
    const [value, setValue] = useState('')
    return (
      <div className="w-80">
        <SearchInput value={value} placeholder="Search" onChange={(e) => setValue(e.target.value)} />
      </div>
    )
  }
}

export const Disabled: Story = {
  render: () => (
    <div className="w-80">
      <SearchInput value="cherry studio" disabled onChange={() => {}} onClear={() => {}} clearLabel="Clear search" />
    </div>
  )
}
