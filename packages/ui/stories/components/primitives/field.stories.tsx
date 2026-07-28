import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  Input
} from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof Field> = {
  title: 'Components/Primitives/Field',
  component: Field,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Field provides consistent layout for form labels, descriptions, and errors. Combine Field and its subcomponents to build structured input groups.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    orientation: {
      control: { type: 'select' },
      options: ['vertical', 'horizontal', 'responsive'],
      description: 'Layout orientation for the field'
    }
  }
}

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="w-80">
      <Field>
        <FieldLabel htmlFor="field-email">Email</FieldLabel>
        <FieldContent>
          <Input id="field-email" type="email" placeholder="you@example.com" />
          <FieldDescription>We will only use this for account recovery.</FieldDescription>
        </FieldContent>
      </Field>
    </div>
  )
}

export const Horizontal: Story = {
  render: () => (
    <div className="w-96">
      <Field orientation="horizontal">
        <FieldLabel htmlFor="field-username">Username</FieldLabel>
        <FieldContent>
          <Input id="field-username" placeholder="cherry-studio" />
          <FieldDescription>Visible in your profile and mentions.</FieldDescription>
        </FieldContent>
      </Field>
    </div>
  )
}

export const WithError: Story = {
  render: () => (
    <div className="w-80">
      <Field data-invalid="true">
        <FieldLabel htmlFor="field-password">Password</FieldLabel>
        <FieldContent>
          <Input id="field-password" type="password" placeholder="Enter password" aria-invalid />
          <FieldError errors={[{ message: 'Password must be at least 8 characters.' }]} />
        </FieldContent>
      </Field>
    </div>
  )
}

export const GroupedFields: Story = {
  render: () => (
    <FieldSet className="w-96">
      <FieldLegend>Account Details</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="field-first-name">First name</FieldLabel>
          <FieldContent>
            <Input id="field-first-name" placeholder="Jane" />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="field-last-name">Last name</FieldLabel>
          <FieldContent>
            <Input id="field-last-name" placeholder="Doe" />
          </FieldContent>
        </Field>

        <FieldSeparator>OR</FieldSeparator>

        <Field orientation="responsive">
          <FieldLabel htmlFor="field-handle">Public handle</FieldLabel>
          <FieldContent>
            <Input id="field-handle" placeholder="@jane" />
            <FieldDescription>Used for public URLs and social sharing.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
    </FieldSet>
  )
}
