import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { Textarea } from '../../../src/components/primitives/textarea'

const meta: Meta<typeof Textarea> = {
  title: 'Components/Primitives/Textarea',
  component: Textarea,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A multi-line text input component with support for labels, error states, character counting, and auto-resizing. Follows the CherryStudio design system from Figma.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
      description: 'Size of the textarea',
      table: {
        defaultValue: { summary: 'md' }
      }
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the textarea is disabled'
    },
    error: {
      control: { type: 'text' },
      description: 'Error message to display'
    },
    autoResize: {
      control: { type: 'boolean' },
      description: 'Whether to automatically resize based on content'
    },
    showCount: {
      control: { type: 'boolean' },
      description: 'Whether to show character count'
    },
    maxLength: {
      control: { type: 'number' },
      description: 'Maximum number of characters allowed'
    },
    required: {
      control: { type: 'boolean' },
      description: 'Whether the field is required'
    },
    label: {
      control: { type: 'text' },
      description: 'Label text for the textarea'
    },
    caption: {
      control: { type: 'text' },
      description: 'Caption text below the textarea'
    },
    placeholder: {
      control: { type: 'text' },
      description: 'Placeholder text'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default
export const Default: Story = {
  render: () => <Textarea placeholder="Enter your text here..." className="w-[400px]" />
}

// With Label
export const WithLabel: Story = {
  render: () => <Textarea label="Description" placeholder="Tell us about yourself..." className="w-[400px]" />
}

// Required Field
export const RequiredField: Story = {
  render: () => <Textarea label="Bio" required placeholder="This field is required..." className="w-[400px]" />
}

// With Caption
export const WithCaption: Story = {
  render: () => (
    <Textarea
      label="Comments"
      caption="Please provide detailed feedback"
      placeholder="Enter your comments..."
      className="w-[400px]"
    />
  )
}

// Error State
export const ErrorState: Story = {
  render: () => (
    <Textarea
      label="Message"
      error="This field cannot be empty"
      placeholder="Enter your message..."
      className="w-[400px]"
    />
  )
}

// With Character Count
export const WithCharacterCount: Story = {
  render: () => (
    <Textarea label="Tweet" showCount maxLength={280} placeholder="What's happening?" className="w-[400px]" />
  )
}

// Auto Resize
export const AutoResize: Story = {
  render: () => (
    <Textarea
      label="Auto-resizing Textarea"
      autoResize
      placeholder="Type to see auto-resize in action..."
      caption="This textarea grows as you type"
      className="w-[400px]"
    />
  )
}

// Disabled State
export const Disabled: Story = {
  render: () => <Textarea label="Disabled Field" disabled value="This textarea is disabled" className="w-[400px]" />
}

// Sizes
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Small (14px font, 12px padding)</p>
        <Textarea size="sm" label="Small Size" placeholder="Small size textarea..." className="w-[400px]" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Default (16px font, 16px padding)</p>
        <Textarea size="md" label="Default Size" placeholder="Default size textarea..." className="w-[400px]" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Large (18px font, 16px padding)</p>
        <Textarea size="lg" label="Large Size" placeholder="Large size textarea..." className="w-[400px]" />
      </div>
    </div>
  )
}

// All States
export const AllStates: Story = {
  render: function AllStatesExample() {
    const [value1, setValue1] = useState('')
    const [value2, setValue2] = useState('This textarea has some content')
    const [value3] = useState('Disabled textarea with content')
    const [value4, setValue4] = useState('')

    return (
      <div className="flex flex-col gap-6">
        {/* Default State */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Default State</p>
          <Textarea
            label="Default"
            placeholder="Enter text..."
            value={value1}
            onChange={(e) => setValue1(e.target.value)}
            className="w-[400px]"
          />
        </div>

        {/* Filled State */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Filled State</p>
          <Textarea label="Filled" value={value2} onChange={(e) => setValue2(e.target.value)} className="w-[400px]" />
        </div>

        {/* Disabled State */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Disabled State</p>
          <Textarea label="Disabled" disabled value={value3} className="w-[400px]" />
        </div>

        {/* Error State */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Error State</p>
          <Textarea
            label="Error"
            error="This field is required"
            value={value4}
            onChange={(e) => setValue4(e.target.value)}
            className="w-[400px]"
          />
        </div>

        {/* Focus State (interactive) */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Focus State (click to focus)</p>
          <Textarea label="Focus" placeholder="Click to see focus state" className="w-[400px]" />
        </div>
      </div>
    )
  }
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [value, setValue] = useState('')

    return (
      <div className="flex flex-col gap-4">
        <Textarea
          label="Controlled Textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Type something..."
          className="w-[400px]"
        />
        <div className="text-sm text-muted-foreground">
          Character count: {value.length}
          <div className="mt-2 rounded-md border border-border bg-muted p-2">
            <strong>Current value:</strong>
            <pre className="mt-1 text-xs">{value || '(empty)'}</pre>
          </div>
        </div>
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: function RealWorldExample() {
    const [feedback, setFeedback] = useState('')
    const [tweet, setTweet] = useState('')
    const [bio, setBio] = useState('')
    const [message, setMessage] = useState('')

    const isTweetValid = tweet.length > 0 && tweet.length <= 280

    return (
      <div className="flex flex-col gap-8">
        {/* Feedback Form */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">User Feedback</h3>
          <Textarea
            label="Feedback"
            required
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Please share your thoughts..."
            caption="Your feedback helps us improve"
            autoResize
            className="w-[500px]"
          />
        </div>

        {/* Tweet Composer */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Tweet Composer</h3>
          <Textarea
            label="What's happening?"
            value={tweet}
            onChange={(e) => setTweet(e.target.value)}
            placeholder="Share your thoughts..."
            showCount
            maxLength={280}
            error={
              !isTweetValid && tweet.length > 0
                ? tweet.length === 0
                  ? 'Tweet cannot be empty'
                  : 'Tweet is too long'
                : undefined
            }
            className="w-[500px]"
          />
        </div>

        {/* Profile Bio */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Profile Bio</h3>
          <Textarea
            label="About You"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell us about yourself..."
            showCount
            maxLength={500}
            caption="This will be displayed on your profile"
            autoResize
            size="lg"
            className="w-[500px]"
          />
        </div>

        {/* Contact Form */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Contact Us</h3>
          <Textarea
            label="Message"
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="How can we help you?"
            error={message.length > 0 && message.length < 10 ? 'Message must be at least 10 characters' : undefined}
            rows={6}
            className="w-[500px]"
          />
        </div>
      </div>
    )
  }
}

// With All Features
export const WithAllFeatures: Story = {
  render: function AllFeaturesExample() {
    const [value, setValue] = useState('')
    const hasError = value.length > 0 && value.length < 20

    return (
      <Textarea
        label="Comment"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter at least 20 characters..."
        caption="Minimum 20 characters required"
        showCount
        maxLength={500}
        autoResize
        error={hasError ? 'Please enter at least 20 characters' : undefined}
        size="lg"
        className="w-[500px]"
      />
    )
  }
}

// Min/Max Rows
export const MinMaxRows: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Fixed 3 rows</p>
        <Textarea
          label="Fixed Height"
          rows={3}
          placeholder="This textarea has a fixed height of 3 rows"
          className="w-[400px]"
        />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Auto-resize (min 3, max 10 rows)</p>
        <Textarea
          label="Auto-resize with Limits"
          autoResize
          rows={3}
          placeholder="Type to see auto-resize with min/max limits..."
          caption="This will grow from 3 to 10 rows as you type"
          className="w-[400px]"
        />
      </div>
    </div>
  )
}

// Dark Mode Preview
export const DarkModePreview: Story = {
  render: () => (
    <div className="dark rounded-lg bg-background p-8">
      <div className="flex flex-col gap-6">
        <Textarea label="Default (Dark)" placeholder="Dark mode textarea..." className="w-[400px]" />
        <Textarea label="With Content (Dark)" value="This is some content in dark mode" className="w-[400px]" />
        <Textarea label="Error (Dark)" error="Error in dark mode" className="w-[400px]" />
        <Textarea label="Disabled (Dark)" disabled value="Disabled in dark mode" className="w-[400px]" />
      </div>
    </div>
  )
}
