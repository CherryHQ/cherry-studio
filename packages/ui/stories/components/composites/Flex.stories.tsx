import { Box, Center, ColFlex, Flex, RowFlex, SpaceBetweenRowFlex } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof Flex> = {
  title: 'Components/Composites/Flex',
  component: Flex,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Thin wrappers around `<div>` that apply common flex recipes: `Box`, `Flex`, `RowFlex`, `ColFlex`, `SpaceBetweenRowFlex`, and `Center`. Use them to keep layout intent readable.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

const Item = ({ label }: { label: string }) => (
  <div className="flex size-12 items-center justify-center rounded-md bg-primary/10 text-xs text-primary">{label}</div>
)

export const BoxExample: Story = {
  name: 'Box',
  render: () => (
    <Box className="w-60 rounded-md border p-4 text-sm">
      <p className="font-medium">Box</p>
      <p className="text-muted-foreground">Plain `box-border` div — no flex.</p>
    </Box>
  )
}

export const FlexExample: Story = {
  name: 'Flex',
  render: () => (
    <Flex className="w-60 gap-2 rounded-md border p-4">
      <Item label="1" />
      <Item label="2" />
      <Item label="3" />
    </Flex>
  )
}

export const RowFlexExample: Story = {
  name: 'RowFlex',
  render: () => (
    <RowFlex className="w-72 gap-2 rounded-md border p-4">
      <Item label="R1" />
      <Item label="R2" />
      <Item label="R3" />
    </RowFlex>
  )
}

export const ColFlexExample: Story = {
  name: 'ColFlex',
  render: () => (
    <ColFlex className="w-60 gap-2 rounded-md border p-4">
      <Item label="C1" />
      <Item label="C2" />
      <Item label="C3" />
    </ColFlex>
  )
}

export const SpaceBetween: Story = {
  name: 'SpaceBetweenRowFlex',
  render: () => (
    <SpaceBetweenRowFlex className="w-80 rounded-md border p-4">
      <Item label="L" />
      <Item label="M" />
      <Item label="R" />
    </SpaceBetweenRowFlex>
  )
}

export const CenterExample: Story = {
  name: 'Center',
  render: () => (
    <Center className="h-32 w-60 rounded-md border">
      <Item label="Hi" />
    </Center>
  )
}
