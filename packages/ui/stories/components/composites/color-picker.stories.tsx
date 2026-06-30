import {
  ColorPicker,
  ColorPickerAlpha,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection
} from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof ColorPicker> = {
  title: 'Components/Composites/color-picker',
  component: ColorPicker,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A composable color picker built on top of the `color` library. Compose the saturation/lightness selection, hue slider, alpha slider, EyeDropper (Chromium-only), format selector, and the read-only format readout — bring only the parts you need. `ColorPicker` is uncontrolled by default; pass `value` to drive it from the outside, and `onChange` reports an `[r, g, b, alpha]` tuple.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

// Default — full selection + hue + alpha + format dropdown + format readout
export const Default: Story = {
  render: () => (
    <div className="w-72">
      <ColorPicker defaultValue="#22c55e" className="gap-3">
        <ColorPickerSelection className="h-40 w-full rounded-lg" />
        <div className="flex items-center gap-2">
          <ColorPickerEyeDropper size="icon-sm" />
          <div className="flex-1 space-y-2">
            <ColorPickerHue />
            <ColorPickerAlpha />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ColorPickerOutput />
          <ColorPickerFormat className="flex-1" />
        </div>
      </ColorPicker>
    </div>
  )
}

// Selection + Hue only — the slim variant ThemeColorPicker uses inside its popover.
export const SelectionAndHue: Story = {
  render: () => (
    <div className="w-64">
      <ColorPicker defaultValue="#3b82f6" className="gap-3">
        <ColorPickerSelection className="h-40 w-full rounded-lg" />
        <div className="flex items-center gap-2">
          <ColorPickerEyeDropper size="icon-sm" />
          <ColorPickerHue className="flex-1" />
        </div>
      </ColorPicker>
    </div>
  )
}

// Controlled — drive the picker from the outside; the swatch tracks the seeded value.
export const Controlled: Story = {
  render: function ControlledExample() {
    const [color, setColor] = useState('#8b5cf6')
    return (
      <div className="w-72 space-y-3">
        <div className="flex items-center gap-3">
          <div
            aria-label="Current color preview"
            className="size-9 rounded-md border border-border"
            style={{ backgroundColor: color }}
          />
          <code className="text-sm">{color}</code>
        </div>
        <ColorPicker
          value={color}
          onChange={([r, g, b]) => {
            const hex = `#${[r, g, b]
              .map((c) =>
                Math.max(0, Math.min(255, Math.round(c)))
                  .toString(16)
                  .padStart(2, '0')
              )
              .join('')}`
            setColor(hex)
          }}
          className="gap-3">
          <ColorPickerSelection className="h-40 w-full rounded-lg" />
          <ColorPickerHue />
        </ColorPicker>
      </div>
    )
  }
}

// EyeDropper — Chromium-only; renders nothing on browsers that don't expose the API.
export const WithEyeDropper: Story = {
  render: () => (
    <div className="w-64">
      <ColorPicker defaultValue="#f59e0b" className="gap-3">
        <ColorPickerSelection className="h-40 w-full rounded-lg" />
        <div className="flex items-center gap-2">
          <ColorPickerEyeDropper size="icon-sm" />
          <ColorPickerHue className="flex-1" />
        </div>
      </ColorPicker>
    </div>
  )
}
