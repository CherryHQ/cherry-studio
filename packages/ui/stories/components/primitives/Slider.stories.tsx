import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { Slider } from '../../../src/components/primitives/slider'

const meta: Meta<typeof Slider> = {
  title: 'Components/Primitives/Slider',
  component: Slider,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An input where the user selects a value from within a given range. Based on Radix UI Slider with size variants.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: { type: 'select' },
      options: ['sm', 'default', 'lg'],
      description: 'The size of the slider'
    },
    defaultValue: {
      control: { type: 'object' },
      description: 'The default value of the slider'
    },
    min: {
      control: { type: 'number' },
      description: 'The minimum value'
    },
    max: {
      control: { type: 'number' },
      description: 'The maximum value'
    },
    step: {
      control: { type: 'number' },
      description: 'The step increment'
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the slider is disabled'
    },
    orientation: {
      control: { type: 'select' },
      options: ['horizontal', 'vertical'],
      description: 'The orientation of the slider'
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  args: {
    defaultValue: [50],
    min: 0,
    max: 100
  },
  render: (args) => (
    <div className="w-96">
      <Slider {...args} />
    </div>
  )
}

// Sizes
export const Small: Story = {
  args: {
    size: 'sm',
    defaultValue: [50],
    min: 0,
    max: 100
  },
  render: (args) => (
    <div className="w-96">
      <Slider {...args} />
    </div>
  )
}

export const Medium: Story = {
  args: {
    size: 'default',
    defaultValue: [50],
    min: 0,
    max: 100
  },
  render: (args) => (
    <div className="w-96">
      <Slider {...args} />
    </div>
  )
}

export const Large: Story = {
  args: {
    size: 'lg',
    defaultValue: [50],
    min: 0,
    max: 100
  },
  render: (args) => (
    <div className="w-96">
      <Slider {...args} />
    </div>
  )
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-8 w-96">
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Small</p>
        <Slider size="sm" defaultValue={[25]} />
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Medium (Default)</p>
        <Slider size="default" defaultValue={[50]} />
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Large</p>
        <Slider size="lg" defaultValue={[75]} />
      </div>
    </div>
  )
}

// Values
export const DifferentValues: Story = {
  render: () => (
    <div className="flex flex-col gap-8 w-96">
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">0%</p>
        <Slider defaultValue={[0]} />
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">50%</p>
        <Slider defaultValue={[50]} />
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">100%</p>
        <Slider defaultValue={[100]} />
      </div>
    </div>
  )
}

// Range Slider
export const RangeSlider: Story = {
  args: {
    defaultValue: [25, 75],
    min: 0,
    max: 100
  },
  render: (args) => (
    <div className="w-96">
      <Slider {...args} />
    </div>
  )
}

export const RangeSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-8 w-96">
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Small Range</p>
        <Slider size="sm" defaultValue={[20, 80]} />
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Medium Range</p>
        <Slider size="default" defaultValue={[25, 75]} />
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Large Range</p>
        <Slider size="lg" defaultValue={[30, 70]} />
      </div>
    </div>
  )
}

// Step
export const WithStep: Story = {
  args: {
    defaultValue: [50],
    min: 0,
    max: 100,
    step: 10
  },
  render: (args) => (
    <div className="w-96">
      <p className="mb-3 text-sm text-muted-foreground">Step: 10</p>
      <Slider {...args} />
    </div>
  )
}

// Disabled
export const Disabled: Story = {
  args: {
    defaultValue: [50],
    disabled: true
  },
  render: (args) => (
    <div className="w-96">
      <Slider {...args} />
    </div>
  )
}

export const DisabledRange: Story = {
  args: {
    defaultValue: [25, 75],
    disabled: true
  },
  render: (args) => (
    <div className="w-96">
      <Slider {...args} />
    </div>
  )
}

// Vertical
export const Vertical: Story = {
  args: {
    defaultValue: [50],
    orientation: 'vertical'
  },
  render: (args) => (
    <div className="h-64">
      <Slider {...args} />
    </div>
  )
}

export const VerticalSizes: Story = {
  render: () => (
    <div className="flex gap-12 h-64">
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Small</p>
        <Slider size="sm" defaultValue={[25]} orientation="vertical" />
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Medium</p>
        <Slider size="default" defaultValue={[50]} orientation="vertical" />
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">Large</p>
        <Slider size="lg" defaultValue={[75]} orientation="vertical" />
      </div>
    </div>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [value, setValue] = useState([50])
    return (
      <div className="w-96">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium">Volume</p>
          <p className="text-sm text-muted-foreground">{value[0]}%</p>
        </div>
        <Slider value={value} onValueChange={setValue} min={0} max={100} step={1} />
      </div>
    )
  }
}

export const ControlledRange: Story = {
  render: function ControlledRangeExample() {
    const [value, setValue] = useState([25, 75])
    return (
      <div className="w-96">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium">Price Range</p>
          <p className="text-sm text-muted-foreground">
            ${value[0]} - ${value[1]}
          </p>
        </div>
        <Slider value={value} onValueChange={setValue} min={0} max={100} step={5} />
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: function RealWorldExample() {
    const [volume, setVolume] = useState([50])
    const [brightness, setBrightness] = useState([75])
    const [priceRange, setPriceRange] = useState([20, 80])
    const [temperature, setTemperature] = useState([22])

    return (
      <div className="flex flex-col gap-8 w-96">
        {/* Volume Control */}
        <div>
          <h3 className="mb-4 text-sm font-semibold">Volume Control</h3>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">🔊 Volume</span>
            <span className="text-sm font-medium">{volume[0]}%</span>
          </div>
          <Slider size="default" value={volume} onValueChange={setVolume} min={0} max={100} step={1} />
        </div>

        {/* Brightness */}
        <div>
          <h3 className="mb-4 text-sm font-semibold">Brightness</h3>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">☀️ Brightness</span>
            <span className="text-sm font-medium">{brightness[0]}%</span>
          </div>
          <Slider size="sm" value={brightness} onValueChange={setBrightness} min={0} max={100} step={5} />
        </div>

        {/* Price Range */}
        <div>
          <h3 className="mb-4 text-sm font-semibold">Price Range Filter</h3>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">💰 Price</span>
            <span className="text-sm font-medium">
              ${priceRange[0]} - ${priceRange[1]}
            </span>
          </div>
          <Slider size="lg" value={priceRange} onValueChange={setPriceRange} min={0} max={100} step={1} />
        </div>

        {/* Temperature */}
        <div>
          <h3 className="mb-4 text-sm font-semibold">Temperature Control</h3>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">🌡️ Temperature</span>
            <span className="text-sm font-medium">{temperature[0]}°C</span>
          </div>
          <Slider value={temperature} onValueChange={setTemperature} min={16} max={30} step={1} />
        </div>

        {/* Disabled State */}
        <div>
          <h3 className="mb-4 text-sm font-semibold">Disabled State</h3>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">🔒 Locked Setting</span>
            <span className="text-sm font-medium">50%</span>
          </div>
          <Slider defaultValue={[50]} disabled />
        </div>
      </div>
    )
  }
}

// All Variants Display (like Figma)
export const ShowcaseAllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-12 p-8">
      {/* Light Background */}
      <div className="bg-white rounded-lg border p-8">
        <h3 className="mb-6 text-lg font-semibold">All Sizes & Progress States</h3>
        <div className="flex gap-8">
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <div className="h-8 flex items-center">Large</div>
            <div className="h-8" />
            <div className="h-8" />
            <div className="h-8 flex items-center">Medium</div>
            <div className="h-8" />
            <div className="h-8" />
            <div className="h-8 flex items-center">Small</div>
            <div className="h-8" />
            <div className="h-8" />
          </div>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground w-16">
            <div className="h-8 flex items-center">0%</div>
            <div className="h-8 flex items-center">50%</div>
            <div className="h-8 flex items-center">100%</div>
            <div className="h-8 flex items-center">0%</div>
            <div className="h-8 flex items-center">50%</div>
            <div className="h-8 flex items-center">100%</div>
            <div className="h-8 flex items-center">0%</div>
            <div className="h-8 flex items-center">50%</div>
            <div className="h-8 flex items-center">100%</div>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <div className="h-8 flex items-center">
              <Slider size="lg" defaultValue={[0]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="lg" defaultValue={[50]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="lg" defaultValue={[100]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="default" defaultValue={[0]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="default" defaultValue={[50]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="default" defaultValue={[100]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="sm" defaultValue={[0]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="sm" defaultValue={[50]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="sm" defaultValue={[100]} className="w-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Dark Background */}
      <div className="bg-slate-900 rounded-lg border border-slate-700 p-8">
        <h3 className="mb-6 text-lg font-semibold text-white">Dark Mode</h3>
        <div className="flex gap-8">
          <div className="flex flex-col gap-1 text-sm text-slate-400">
            <div className="h-8 flex items-center">Large</div>
            <div className="h-8" />
            <div className="h-8" />
            <div className="h-8 flex items-center">Medium</div>
            <div className="h-8" />
            <div className="h-8" />
            <div className="h-8 flex items-center">Small</div>
            <div className="h-8" />
            <div className="h-8" />
          </div>
          <div className="flex flex-col gap-1 text-sm text-slate-400 w-16">
            <div className="h-8 flex items-center">0%</div>
            <div className="h-8 flex items-center">50%</div>
            <div className="h-8 flex items-center">100%</div>
            <div className="h-8 flex items-center">0%</div>
            <div className="h-8 flex items-center">50%</div>
            <div className="h-8 flex items-center">100%</div>
            <div className="h-8 flex items-center">0%</div>
            <div className="h-8 flex items-center">50%</div>
            <div className="h-8 flex items-center">100%</div>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <div className="h-8 flex items-center">
              <Slider size="lg" defaultValue={[0]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="lg" defaultValue={[50]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="lg" defaultValue={[100]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="default" defaultValue={[0]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="default" defaultValue={[50]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="default" defaultValue={[100]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="sm" defaultValue={[0]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="sm" defaultValue={[50]} className="w-full" />
            </div>
            <div className="h-8 flex items-center">
              <Slider size="sm" defaultValue={[100]} className="w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
