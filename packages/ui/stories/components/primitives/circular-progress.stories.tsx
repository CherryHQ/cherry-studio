import { CircularProgress, Slider } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof CircularProgress> = {
  title: 'Components/Primitives/CircularProgress',
  component: CircularProgress,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'A circular progress indicator with customizable size, stroke, and label rendering.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
      description: 'Progress value (0-100)'
    },
    size: {
      control: { type: 'number', min: 32, max: 240, step: 4 },
      description: 'Diameter of the circle in pixels'
    },
    strokeWidth: {
      control: { type: 'number', min: 2, max: 24, step: 1 },
      description: 'Overrides both circle and progress stroke widths'
    },
    circleStrokeWidth: {
      control: { type: 'number', min: 2, max: 24, step: 1 },
      description: 'Base circle stroke width'
    },
    progressStrokeWidth: {
      control: { type: 'number', min: 2, max: 24, step: 1 },
      description: 'Progress stroke width'
    },
    shape: {
      control: { type: 'select' },
      options: ['round', 'square'],
      description: 'Stroke line cap shape'
    },
    showLabel: {
      control: { type: 'boolean' },
      description: 'Whether to show the label in the center'
    },
    renderLabel: {
      control: false,
      description: 'Custom label renderer'
    },
    className: {
      control: { type: 'text' },
      description: 'Base circle class name'
    },
    progressClassName: {
      control: { type: 'text' },
      description: 'Progress circle class name'
    },
    labelClassName: {
      control: { type: 'text' },
      description: 'Label class name'
    }
  }
}

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    value: 68,
    size: 120,
    showLabel: true,
    labelClassName: 'text-lg font-semibold'
  },
  render: (args) => <CircularProgress {...args} renderLabel={(value) => `${value}%`} />
}

export const ColorVariations: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <CircularProgress
        value={42}
        size={96}
        strokeWidth={10}
        showLabel
        labelClassName="text-sm font-semibold"
        renderLabel={(value) => `${value}%`}
        className="stroke-indigo-500/25"
        progressClassName="stroke-indigo-600"
      />
      <CircularProgress
        value={78}
        size={96}
        strokeWidth={10}
        showLabel
        labelClassName="text-sm font-semibold"
        renderLabel={(value) => `${value}%`}
        className="stroke-orange-500/25"
        progressClassName="stroke-orange-600"
      />
      <CircularProgress
        value={56}
        size={96}
        strokeWidth={10}
        showLabel
        labelClassName="text-sm font-semibold"
        renderLabel={(value) => `${value}%`}
        className="stroke-emerald-500/25"
        progressClassName="stroke-emerald-600"
      />
    </div>
  )
}

export const ShapeComparison: Story = {
  render: () => (
    <div className="flex items-center gap-8">
      <CircularProgress
        value={64}
        size={110}
        strokeWidth={12}
        showLabel
        renderLabel={(value) => `${value}%`}
        labelClassName="text-sm font-medium"
        className="stroke-slate-300"
        progressClassName="stroke-slate-700"
      />
      <CircularProgress
        value={64}
        size={110}
        strokeWidth={12}
        shape="square"
        showLabel
        renderLabel={(value) => `${value}%`}
        labelClassName="text-sm font-medium"
        className="stroke-slate-300"
        progressClassName="stroke-slate-700"
      />
    </div>
  )
}

export const WithSlider: Story = {
  render: function WithSliderExample() {
    const [progress, setProgress] = useState([32])

    return (
      <div className="flex w-64 flex-col items-center gap-6">
        <CircularProgress
          value={progress[0]}
          size={140}
          strokeWidth={12}
          showLabel
          labelClassName="text-xl font-semibold"
          renderLabel={(value) => `${value}%`}
          className="stroke-sky-500/20"
          progressClassName="stroke-sky-600"
        />
        <Slider value={progress} onValueChange={setProgress} max={100} step={1} className="w-full" />
      </div>
    )
  }
}
