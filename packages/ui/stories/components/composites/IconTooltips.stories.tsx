import { HelpTooltip, InfoTooltip, WarnTooltip } from '@cherrystudio/ui'
import type { Meta } from '@storybook/react'

const meta: Meta = {
  title: 'Components/Composites/IconTooltips',
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Lucide-icon tooltips for inline hints: `HelpTooltip`, `InfoTooltip`, and `WarnTooltip`. Each wraps `Tooltip` with a sensible default color and aria-label so you can drop one beside a setting or field.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta

export const Gallery = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2 text-sm">
        Help <HelpTooltip content="Shows a helpful hint." />
      </div>
      <div className="flex items-center gap-2 text-sm">
        Info <InfoTooltip content="Provides extra context." />
      </div>
      <div className="flex items-center gap-2 text-sm">
        Warn <WarnTooltip content="Heads up — this action is irreversible." />
      </div>
    </div>
  )
}

export const InFormLabel = {
  render: () => (
    <form className="flex w-80 flex-col gap-4 rounded-md border bg-card p-4 text-sm">
      <label className="flex items-center gap-2">
        Temperature
        <InfoTooltip content="Higher values produce more diverse output." />
      </label>
      <label className="flex items-center gap-2">
        Delete project
        <WarnTooltip content="This cannot be undone." />
      </label>
      <label className="flex items-center gap-2">
        API key
        <HelpTooltip content="Find this in your provider dashboard." />
      </label>
    </form>
  )
}

export const CustomSize = {
  render: () => (
    <div className="flex items-center gap-6">
      <InfoTooltip content="Small" iconProps={{ size: 12 }} />
      <InfoTooltip content="Default" />
      <InfoTooltip content="Large" iconProps={{ size: 20 }} />
    </div>
  )
}
