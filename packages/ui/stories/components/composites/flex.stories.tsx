import {
  Box,
  Center,
  Container,
  Flex,
  Grid,
  HStack,
  PageShell,
  Spacer,
  Stack,
  TruncatingRow,
  VStack
} from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof Flex> = {
  title: 'Components/Composites/flex',
  component: Flex,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Gap-aware layout primitives built on `Box`. Axes are owned by typed props — `direction`/`align`/`justify`/`gap`/`wrap` — that compile to a closed Tailwind class lookup; padding/sizing/color stay in `className`. Use the intent presets (`HStack`, `VStack`, `Stack`, `Center`, `Grid`, `TruncatingRow`, `PageShell`, `Container`, `Spacer`) for the common shapes. The legacy `RowFlex`/`ColFlex`/`SpaceBetweenRowFlex` are deprecated in favor of `HStack`/`VStack`/`HStack justify="between"`.'
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
      <p className="text-muted-foreground">Plain `box-border` div — no flex. Carries `asChild` + `ref`.</p>
    </Box>
  )
}

export const FlexExample: Story = {
  name: 'Flex',
  render: () => (
    <Flex align="center" justify="between" gap={2} className="w-72 rounded-md border p-4">
      <Item label="1" />
      <Item label="2" />
      <Item label="3" />
    </Flex>
  )
}

export const HStackExample: Story = {
  name: 'HStack',
  render: () => (
    <HStack gap={2} className="w-72 rounded-md border p-4">
      <Item label="H1" />
      <Item label="H2" />
      <Item label="H3" />
    </HStack>
  )
}

export const VStackExample: Story = {
  name: 'VStack',
  render: () => (
    <VStack gap={2} className="w-60 rounded-md border p-4">
      <Item label="V1" />
      <Item label="V2" />
      <Item label="V3" />
    </VStack>
  )
}

export const StackExample: Story = {
  name: 'Stack',
  render: () => (
    <Stack direction="row" gap={3} className="w-72 rounded-md border p-4">
      <Item label="S1" />
      <Item label="S2" />
    </Stack>
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

export const GridExample: Story = {
  name: 'Grid',
  render: () => (
    <Grid columns={{ base: 2, sm: 3 }} gap={3} className="w-72 rounded-md border p-4">
      {Array.from({ length: 6 }, (_, i) => (
        <Item key={i} label={`${i + 1}`} />
      ))}
    </Grid>
  )
}

export const TruncatingRowExample: Story = {
  name: 'TruncatingRow',
  render: () => (
    <TruncatingRow
      gap={2}
      leading={<Item label="ico" />}
      trailing={<span className="rounded bg-muted px-1.5 py-0.5 text-xs">badge</span>}
      className="w-72 rounded-md border p-3">
      <span className="truncate">A very long label that will truncate before it overlaps the trailing badge</span>
    </TruncatingRow>
  )
}

export const SpacerExample: Story = {
  name: 'Spacer',
  render: () => (
    <HStack gap={2} className="w-72 rounded-md border p-4">
      <Item label="L" />
      <Spacer />
      <Item label="R" />
    </HStack>
  )
}

export const PageShellExample: Story = {
  name: 'PageShell',
  render: () => (
    <div className="h-48 w-72 overflow-hidden rounded-md border">
      <PageShell scroll className="p-4">
        <VStack gap={2}>
          {Array.from({ length: 8 }, (_, i) => (
            <Item key={i} label={`row ${i + 1}`} />
          ))}
        </VStack>
      </PageShell>
    </div>
  )
}

export const ContainerExample: Story = {
  name: 'Container',
  render: () => (
    <Container size="settings" className="w-[40rem] border bg-muted/30">
      <div className="rounded-md border bg-card p-4 text-sm">Centered, width-capped content (max-w-3xl)</div>
    </Container>
  )
}
