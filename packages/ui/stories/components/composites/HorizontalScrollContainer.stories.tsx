import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { HorizontalScrollContainer } from '../../../src/components'

const meta: Meta<typeof HorizontalScrollContainer> = {
  title: 'Components/Composites/HorizontalScrollContainer',
  component: HorizontalScrollContainer,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    scrollDistance: { control: { type: 'range', min: 50, max: 500, step: 50 } },
    gap: { control: 'text' },
    expandable: { control: 'boolean' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default example
export const Default: Story = {
  args: {
    children: (
      <div className="flex gap-2">
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className="rounded bg-gray-100 px-4 py-2 whitespace-nowrap">
            Item {i + 1}
          </div>
        ))}
      </div>
    ),
    scrollDistance: 200
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    )
  ]
}

// With Tags
export const WithTags: Story = {
  args: {
    children: (
      <>
        {[
          'React',
          'TypeScript',
          'JavaScript',
          'HTML',
          'CSS',
          'Node.js',
          'Express',
          'MongoDB',
          'PostgreSQL',
          'Docker',
          'Kubernetes',
          'AWS',
          'Azure',
          'GraphQL',
          'REST API'
        ].map((tag) => (
          <span key={tag} className="rounded-full bg-blue-500 px-3 py-1 text-xs whitespace-nowrap text-white">
            {tag}
          </span>
        ))}
      </>
    ),
    gap: '8px'
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    )
  ]
}

// Expandable
export const Expandable: Story = {
  args: {
    expandable: true,
    children: (
      <>
        {['Frontend', 'Backend', 'DevOps', 'Mobile', 'Desktop', 'Web', 'Cloud', 'Database', 'Security', 'Testing'].map(
          (category) => (
            <div key={category} className="rounded bg-green-500 px-3.5 py-1.5 text-sm whitespace-nowrap text-white">
              {category}
            </div>
          )
        )}
      </>
    ),
    gap: '10px'
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    )
  ]
}

// With Cards
export const WithCards: Story = {
  args: {
    scrollDistance: 300,
    gap: '16px',
    children: (
      <>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="min-w-[200px] rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h4 className="mb-2 font-semibold">Card {i + 1}</h4>
            <p className="text-sm text-gray-600">This is a sample card content for demonstration purposes.</p>
          </div>
        ))}
      </>
    )
  },
  decorators: [
    (Story) => (
      <div className="w-[600px]">
        <Story />
      </div>
    )
  ]
}

// Interactive Example
export const Interactive: Story = {
  render: function InteractiveExample() {
    const [items, setItems] = useState([
      'Apple',
      'Banana',
      'Cherry',
      'Date',
      'Elderberry',
      'Fig',
      'Grape',
      'Honeydew',
      'Kiwi',
      'Lemon',
      'Mango',
      'Orange'
    ])

    return (
      <div className="w-96">
        <HorizontalScrollContainer gap="8px" scrollDistance={150}>
          {items.map((item) => (
            <div
              key={item}
              className="cursor-pointer rounded-2xl bg-orange-500 px-4 py-2 whitespace-nowrap text-white hover:bg-orange-600"
              onClick={() => alert(`Clicked: ${item}`)}>
              {item}
            </div>
          ))}
        </HorizontalScrollContainer>
        <button
          type="button"
          className="mt-4 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          onClick={() => setItems([...items, `Item ${items.length + 1}`])}>
          Add Item
        </button>
      </div>
    )
  }
}

// Different Gaps
export const DifferentGaps: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <h4 className="mb-2 font-semibold">Small Gap (4px)</h4>
        <HorizontalScrollContainer gap="4px">
          {Array.from({ length: 15 }, (_, i) => (
            <span key={i} className="rounded bg-purple-600 px-3 py-1.5 text-white">
              Item {i + 1}
            </span>
          ))}
        </HorizontalScrollContainer>
      </div>

      <div>
        <h4 className="mb-2 font-semibold">Medium Gap (12px)</h4>
        <HorizontalScrollContainer gap="12px">
          {Array.from({ length: 15 }, (_, i) => (
            <span key={i} className="rounded bg-cyan-500 px-3 py-1.5 text-white">
              Item {i + 1}
            </span>
          ))}
        </HorizontalScrollContainer>
      </div>

      <div>
        <h4 className="mb-2 font-semibold">Large Gap (20px)</h4>
        <HorizontalScrollContainer gap="20px">
          {Array.from({ length: 15 }, (_, i) => (
            <span key={i} className="rounded bg-pink-500 px-3 py-1.5 text-white">
              Item {i + 1}
            </span>
          ))}
        </HorizontalScrollContainer>
      </div>
    </div>
  )
}
