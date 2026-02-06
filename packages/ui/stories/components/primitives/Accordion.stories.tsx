import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import type { ComponentProps } from 'react'

const meta: Meta<typeof Accordion> = {
  title: 'Components/Primitives/Accordion',
  component: Accordion,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'A vertically stacked set of interactive headings that reveal content. Based on shadcn/ui.'
      }
    }
  },
  tags: ['autodocs'],
  args: {
    type: 'single',
    collapsible: true,
    className: 'w-[520px]'
  },
  argTypes: {
    type: {
      control: { type: 'select' },
      options: ['single', 'multiple'],
      description: 'The accordion selection mode'
    },
    collapsible: {
      control: { type: 'boolean' },
      description: 'Allow the item to collapse after opening'
    },
    defaultValue: {
      control: { type: 'text' },
      description: 'The default open item value'
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes'
    }
  }
}

export default meta
type AccordionArgs = ComponentProps<typeof Accordion>
type Story = StoryObj<AccordionArgs>

export const Default: Story = {
  args: {
    defaultValue: 'item-1'
  },
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="item-1">
        <AccordionTrigger>Is it accessible?</AccordionTrigger>
        <AccordionContent>Yes. It adheres to the WAI-ARIA design pattern.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Is it styled with the design tokens?</AccordionTrigger>
        <AccordionContent>It uses text, border, and focus styles aligned with the UI system.</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

export const Multiple: Story = {
  args: {
    type: 'multiple',
    defaultValue: ['item-1', 'item-2']
  },
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="item-1">
        <AccordionTrigger>Can I open multiple items?</AccordionTrigger>
        <AccordionContent>Yes. Set type to multiple to allow several open panels.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Does it animate?</AccordionTrigger>
        <AccordionContent>Open and close transitions are handled by Radix data-state classes.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Is it keyboard friendly?</AccordionTrigger>
        <AccordionContent>Keyboard navigation and focus handling are included.</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
