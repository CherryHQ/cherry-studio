import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import * as Textarea from '../../../src/components/primitives/textarea'

const meta: Meta<typeof Textarea.Root> = {
  title: 'Components/Primitives/Textarea',
  component: Textarea.Root,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A composable multi-line text input built with Radix primitives. Supports controlled/uncontrolled modes, auto-resize, character counting, and error states.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

// Basic Usage
export const Basic: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <Textarea.Input placeholder="Type your message here..." />
    </Textarea.Root>
  )
}

// With Label
export const WithLabel: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <Textarea.Label>Description</Textarea.Label>
      <Textarea.Input placeholder="Tell us about yourself..." />
    </Textarea.Root>
  )
}

// Required Field
export const RequiredField: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <Textarea.Label required>Bio</Textarea.Label>
      <Textarea.Input placeholder="This field is required..." />
    </Textarea.Root>
  )
}

// With Caption
export const WithCaption: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <Textarea.Label>Comments</Textarea.Label>
      <Textarea.Input placeholder="Enter your comments..." />
      <Textarea.Caption>Please provide detailed feedback</Textarea.Caption>
    </Textarea.Root>
  )
}

// Error State
export const ErrorState: Story = {
  render: () => (
    <Textarea.Root error="This field cannot be empty" className="w-[400px]">
      <Textarea.Label>Message</Textarea.Label>
      <Textarea.Input placeholder="Enter your message..." />
      <Textarea.Caption>This field cannot be empty</Textarea.Caption>
    </Textarea.Root>
  )
}

// With Character Count
export const WithCharacterCount: Story = {
  render: function WithCharacterCountExample() {
    const [value, setValue] = useState('')

    return (
      <Textarea.Root className="w-[400px]">
        <Textarea.Label>Tweet</Textarea.Label>
        <div className="relative">
          <Textarea.Input value={value} onValueChange={setValue} maxLength={280} placeholder="What's happening?" />
          <Textarea.CharCount value={value} maxLength={280} />
        </div>
        <Textarea.Caption>Maximum 280 characters</Textarea.Caption>
      </Textarea.Root>
    )
  }
}

// Auto Resize
export const AutoResize: Story = {
  render: function AutoResizeExample() {
    const [value, setValue] = useState('')

    return (
      <Textarea.Root className="w-[400px]">
        <Textarea.Label>Auto-resizing Textarea</Textarea.Label>
        <Textarea.Input
          value={value}
          onValueChange={setValue}
          autoSize
          placeholder="This textarea grows with your content..."
        />
        <Textarea.Caption>Try typing multiple lines</Textarea.Caption>
      </Textarea.Root>
    )
  }
}

// Disabled State
export const Disabled: Story = {
  render: () => (
    <Textarea.Root disabled className="w-[400px]">
      <Textarea.Label>Disabled Field</Textarea.Label>
      <Textarea.Input defaultValue="This textarea is disabled" />
    </Textarea.Root>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [value, setValue] = useState('')

    return (
      <div className="flex flex-col gap-4">
        <Textarea.Root className="w-[400px]">
          <Textarea.Label>Controlled Textarea</Textarea.Label>
          <Textarea.Input value={value} onValueChange={setValue} placeholder="Type something..." />
        </Textarea.Root>

        <div className="w-[400px] text-sm text-muted-foreground">
          <div className="rounded-md border border-border bg-muted p-3">
            <div className="mb-1 font-medium">Current value:</div>
            <pre className="text-xs">{value || '(empty)'}</pre>
            <div className="mt-2 text-xs">Characters: {value.length}</div>
          </div>
        </div>
      </div>
    )
  }
}

// All States
export const AllStates: Story = {
  render: function AllStatesExample() {
    const [value1, setValue1] = useState('')
    const [value2, setValue2] = useState('This textarea has some content')
    const [value4, setValue4] = useState('')

    return (
      <div className="flex flex-col gap-6">
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Default State</p>
          <Textarea.Root className="w-[400px]">
            <Textarea.Label>Default</Textarea.Label>
            <Textarea.Input value={value1} onValueChange={setValue1} placeholder="Enter text..." />
          </Textarea.Root>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Filled State</p>
          <Textarea.Root className="w-[400px]">
            <Textarea.Label>Filled</Textarea.Label>
            <Textarea.Input value={value2} onValueChange={setValue2} />
          </Textarea.Root>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Disabled State</p>
          <Textarea.Root disabled className="w-[400px]">
            <Textarea.Label>Disabled</Textarea.Label>
            <Textarea.Input defaultValue="Disabled textarea with content" />
          </Textarea.Root>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Error State</p>
          <Textarea.Root error="This field is required" className="w-[400px]">
            <Textarea.Label>Error</Textarea.Label>
            <Textarea.Input value={value4} onValueChange={setValue4} />
            <Textarea.Caption>This field is required</Textarea.Caption>
          </Textarea.Root>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Focus State (click to focus)</p>
          <Textarea.Root className="w-[400px]">
            <Textarea.Label>Focus</Textarea.Label>
            <Textarea.Input placeholder="Click to see focus state" />
          </Textarea.Root>
        </div>
      </div>
    )
  }
}

// Real World Examples
export const RealWorldExamples: Story = {
  render: function RealWorldExample() {
    const [tweet, setTweet] = useState('')
    const [feedback, setFeedback] = useState('')
    const [message, setMessage] = useState('')

    const tweetError = tweet.length > 280 ? 'Tweet is too long' : undefined
    const messageError =
      message.length > 0 && message.length < 10 ? 'Message must be at least 10 characters' : undefined

    return (
      <div className="flex flex-col gap-8">
        {/* Tweet Composer */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Tweet Composer</h3>
          <Textarea.Root error={tweetError} className="w-[500px]">
            <Textarea.Label>What's happening?</Textarea.Label>
            <div className="relative">
              <Textarea.Input
                value={tweet}
                onValueChange={setTweet}
                maxLength={280}
                placeholder="Share your thoughts..."
              />
              <Textarea.CharCount value={tweet} maxLength={280} />
            </div>
            {tweetError && <Textarea.Caption>{tweetError}</Textarea.Caption>}
          </Textarea.Root>
        </div>

        {/* Feedback Form */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">User Feedback</h3>
          <Textarea.Root className="w-[500px]">
            <Textarea.Label required>Feedback</Textarea.Label>
            <Textarea.Input
              value={feedback}
              onValueChange={setFeedback}
              placeholder="Please share your thoughts..."
              rows={4}
            />
            <Textarea.Caption>Your feedback helps us improve</Textarea.Caption>
          </Textarea.Root>
        </div>

        {/* Contact Form */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Contact Us</h3>
          <Textarea.Root error={messageError} className="w-[500px]">
            <Textarea.Label required>Message</Textarea.Label>
            <Textarea.Input value={message} onValueChange={setMessage} placeholder="How can we help you?" rows={6} />
            {messageError ? (
              <Textarea.Caption>{messageError}</Textarea.Caption>
            ) : (
              <Textarea.Caption>Minimum 10 characters required</Textarea.Caption>
            )}
          </Textarea.Root>
        </div>
      </div>
    )
  }
}

// Dark Mode
export const DarkMode: Story = {
  render: () => (
    <div className="dark rounded-lg bg-background p-8">
      <div className="flex flex-col gap-6">
        <Textarea.Root className="w-[400px]">
          <Textarea.Label>Default (Dark)</Textarea.Label>
          <Textarea.Input placeholder="Dark mode textarea..." />
        </Textarea.Root>

        <Textarea.Root className="w-[400px]">
          <Textarea.Label>With Content (Dark)</Textarea.Label>
          <Textarea.Input defaultValue="This is some content in dark mode" />
        </Textarea.Root>

        <Textarea.Root error="Error in dark mode" className="w-[400px]">
          <Textarea.Label>Error (Dark)</Textarea.Label>
          <Textarea.Input />
          <Textarea.Caption>Error in dark mode</Textarea.Caption>
        </Textarea.Root>

        <Textarea.Root disabled className="w-[400px]">
          <Textarea.Label>Disabled (Dark)</Textarea.Label>
          <Textarea.Input defaultValue="Disabled in dark mode" />
        </Textarea.Root>
      </div>
    </div>
  )
}

// Composition Example
export const CompositionExample: Story = {
  render: function CompositionExampleRender() {
    const [bio, setBio] = useState('')

    return (
      <Textarea.Root className="w-[500px]">
        <Textarea.Label required>Profile Bio</Textarea.Label>
        <div className="relative">
          <Textarea.Input
            value={bio}
            onValueChange={setBio}
            placeholder="Tell us about yourself..."
            maxLength={500}
            autoSize
          />
          <Textarea.CharCount value={bio} maxLength={500} />
        </div>
        <Textarea.Caption>This will be displayed on your profile (max 500 characters)</Textarea.Caption>
      </Textarea.Root>
    )
  }
}
