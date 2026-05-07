import type { DateTimeGranularity } from '@cherrystudio/ui'
import { DateTimePicker } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

const meta: Meta<typeof DateTimePicker> = {
  title: 'Components/Composites/DateTimePicker',
  component: DateTimePicker,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A shadcn-style date and time picker built from Popover, DayPicker dropdown navigation, Select, and compact time inputs. Supports configurable time granularity and date-fns format strings.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    granularity: {
      control: 'select',
      options: ['day', 'hour', 'minute', 'second'] satisfies DateTimeGranularity[]
    },
    format: {
      control: 'text'
    },
    disabled: {
      control: 'boolean'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const DateOnly: Story = {
  render: function DateOnlyExample() {
    const [value, setValue] = useState<Date | undefined>(new Date(2026, 3, 29))

    return (
      <DateTimePicker
        value={value}
        onChange={setValue}
        granularity="day"
        format="yyyy-MM-dd"
        placeholder="Pick a date"
      />
    )
  }
}

export const WithMinutes: Story = {
  render: function WithMinutesExample() {
    const [value, setValue] = useState<Date | undefined>(new Date(2026, 3, 29, 14, 30))

    return (
      <DateTimePicker
        value={value}
        onChange={setValue}
        granularity="minute"
        format="yyyy-MM-dd HH:mm"
        placeholder="Pick date and time"
      />
    )
  }
}

export const WithSeconds: Story = {
  render: function WithSecondsExample() {
    const [value, setValue] = useState<Date | undefined>(new Date(2026, 3, 29, 14, 30, 45))

    return (
      <DateTimePicker
        value={value}
        onChange={setValue}
        granularity="second"
        format="yyyy-MM-dd HH:mm:ss"
        placeholder="Pick date and time"
      />
    )
  }
}

export const CustomYearRange: Story = {
  render: function CustomYearRangeExample() {
    const [value, setValue] = useState<Date | undefined>(new Date(2026, 3, 29, 9, 0))

    return (
      <DateTimePicker
        value={value}
        onChange={setValue}
        granularity="hour"
        format="PPP HH':00'"
        calendarProps={{
          startMonth: new Date(2020, 0),
          endMonth: new Date(2035, 11)
        }}
      />
    )
  }
}

export const Disabled: Story = {
  render: function DisabledExample() {
    return (
      <DateTimePicker
        defaultValue={new Date(2026, 3, 29, 14, 30)}
        granularity="minute"
        format="yyyy-MM-dd HH:mm"
        disabled
      />
    )
  }
}
