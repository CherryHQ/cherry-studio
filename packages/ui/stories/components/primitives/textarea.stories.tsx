import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import * as Textarea from '@cherrystudio/ui/components/primitives/textarea'

const meta: Meta<typeof Textarea.Input> = {
  title: 'Components/Primitives/Textarea',
  component: Textarea.Input,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A composable multi-line text input built with Radix primitives. Supports controlled/uncontrolled modes, auto-resize (via field-sizing-content), character counting, and error states.'
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
    <div className="flex w-[400px] w-full flex-col gap-2">
      <Textarea.Input placeholder="Type your message here..." />
    </div>
  )
}

// With Label
export const WithLabel: Story = {
  render: () => (
    <div className="flex w-[400px] w-full flex-col gap-2">
      <div className="text-lg leading-[22px] font-bold">Description</div>
      <Textarea.Input placeholder="Tell us about yourself..." />
    </div>
  )
}

// Required Field
export const RequiredField: Story = {
  render: () => (
    <div className="flex w-[400px] w-full flex-col gap-2">
      <div className="text-lg leading-[22px] font-bold">
        <span className="mr-1 text-destructive">*</span>Bio
      </div>
      <Textarea.Input placeholder="This field is required..." />
    </div>
  )
}

// With Caption
export const WithCaption: Story = {
  render: () => (
    <div className="flex w-[400px] w-full flex-col gap-2">
      <div className="text-lg leading-[22px] font-bold">Comments</div>
      <Textarea.Input placeholder="Enter your comments..." />
      <div className="flex items-center gap-1.5 text-sm leading-4 text-foreground-tertiary">
        Please provide detailed feedback
      </div>
    </div>
  )
}

// Error State
export const ErrorState: Story = {
  render: () => (
    <div className="flex w-[400px] w-full flex-col gap-2">
      <div className="text-lg leading-[22px] font-bold">Message</div>
      <Textarea.Input placeholder="Enter your message..." hasError />
      <div className="flex items-center gap-1.5 text-sm leading-4 text-destructive">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <span>This field cannot be empty</span>
      </div>
    </div>
  )
}

// With Character Count
export const WithCharacterCount: Story = {
  render: function WithCharacterCountExample() {
    const [value, setValue] = useState('')

    return (
      <div className="flex w-[400px] w-full flex-col gap-2">
        <div className="text-lg leading-[22px] font-bold">Tweet</div>
        <div className="relative">
          <Textarea.Input value={value} onValueChange={setValue} maxLength={280} placeholder="What's happening?" />
          <Textarea.CharCount value={value} maxLength={280} />
        </div>
        <div className="flex items-center gap-1.5 text-sm leading-4 text-foreground-tertiary">
          Maximum 280 characters
        </div>
      </div>
    )
  }
}

// Auto Resize (built-in via field-sizing-content)
export const AutoResize: Story = {
  render: function AutoResizeExample() {
    const [value, setValue] = useState('')

    return (
      <div className="flex w-[400px] w-full flex-col gap-2">
        <div className="text-lg leading-[22px] font-bold">Auto-resizing Textarea</div>
        <Textarea.Input value={value} onValueChange={setValue} placeholder="This textarea grows with your content..." />
        <div className="flex items-center gap-1.5 text-sm leading-4 text-foreground-tertiary">
          Try typing multiple lines
        </div>
      </div>
    )
  }
}

// Disabled State
export const Disabled: Story = {
  render: () => (
    <div className="flex w-[400px] w-full flex-col gap-2">
      <div className="cursor-not-allowed text-lg leading-[22px] font-bold opacity-70">Disabled Field</div>
      <Textarea.Input defaultValue="This textarea is disabled" disabled />
    </div>
  )
}

// Controlled
export const Controlled: Story = {
  render: function ControlledExample() {
    const [value, setValue] = useState('')

    return (
      <div className="flex flex-col gap-4">
        <div className="flex w-[400px] w-full flex-col gap-2">
          <div className="text-lg leading-[22px] font-bold">Controlled Textarea</div>
          <Textarea.Input value={value} onValueChange={setValue} placeholder="Type something..." />
        </div>

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
          <div className="flex w-[400px] w-full flex-col gap-2">
            <div className="text-lg leading-[22px] font-bold">Default</div>
            <Textarea.Input value={value1} onValueChange={setValue1} placeholder="Enter text..." />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Filled State</p>
          <div className="flex w-[400px] w-full flex-col gap-2">
            <div className="text-lg leading-[22px] font-bold">Filled</div>
            <Textarea.Input value={value2} onValueChange={setValue2} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Disabled State</p>
          <div className="flex w-[400px] w-full flex-col gap-2">
            <div className="cursor-not-allowed text-lg leading-[22px] font-bold opacity-70">Disabled</div>
            <Textarea.Input defaultValue="Disabled textarea with content" disabled />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Error State</p>
          <div className="flex w-[400px] w-full flex-col gap-2">
            <div className="text-lg leading-[22px] font-bold">Error</div>
            <Textarea.Input value={value4} onValueChange={setValue4} hasError />
            <div className="flex items-center gap-1.5 text-sm leading-4 text-destructive">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span>This field is required</span>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Focus State (click to focus)</p>
          <div className="flex w-[400px] w-full flex-col gap-2">
            <div className="text-lg leading-[22px] font-bold">Focus</div>
            <Textarea.Input placeholder="Click to see focus state" />
          </div>
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
          <div className="flex w-[500px] w-full flex-col gap-2">
            <div className="text-lg leading-[22px] font-bold">What's happening?</div>
            <div className="relative">
              <Textarea.Input
                value={tweet}
                onValueChange={setTweet}
                maxLength={280}
                placeholder="Share your thoughts..."
                hasError={!!tweetError}
              />
              <Textarea.CharCount value={tweet} maxLength={280} />
            </div>
            {tweetError && (
              <div className="flex items-center gap-1.5 text-sm leading-4 text-destructive">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
                <span>{tweetError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Feedback Form */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">User Feedback</h3>
          <div className="flex w-[500px] w-full flex-col gap-2">
            <div className="text-lg leading-[22px] font-bold">
              <span className="mr-1 text-destructive">*</span>Feedback
            </div>
            <Textarea.Input
              value={feedback}
              onValueChange={setFeedback}
              placeholder="Please share your thoughts..."
              rows={4}
            />
            <div className="flex items-center gap-1.5 text-sm leading-4 text-foreground-tertiary">
              Your feedback helps us improve
            </div>
          </div>
        </div>

        {/* Contact Form */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Contact Us</h3>
          <div className="flex w-[500px] w-full flex-col gap-2">
            <div className="text-lg leading-[22px] font-bold">
              <span className="mr-1 text-destructive">*</span>Message
            </div>
            <Textarea.Input
              value={message}
              onValueChange={setMessage}
              placeholder="How can we help you?"
              rows={6}
              hasError={!!messageError}
            />
            {messageError ? (
              <div className="flex items-center gap-1.5 text-sm leading-4 text-destructive">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
                <span>{messageError}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm leading-4 text-foreground-tertiary">
                Minimum 10 characters required
              </div>
            )}
          </div>
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
        <div className="flex w-[400px] w-full flex-col gap-2">
          <div className="text-lg leading-[22px] font-bold">Default (Dark)</div>
          <Textarea.Input placeholder="Dark mode textarea..." />
        </div>

        <div className="flex w-[400px] w-full flex-col gap-2">
          <div className="text-lg leading-[22px] font-bold">With Content (Dark)</div>
          <Textarea.Input defaultValue="This is some content in dark mode" />
        </div>

        <div className="flex w-[400px] w-full flex-col gap-2">
          <div className="text-lg leading-[22px] font-bold">Error (Dark)</div>
          <Textarea.Input hasError />
          <div className="flex items-center gap-1.5 text-sm leading-4 text-destructive">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <span>Error in dark mode</span>
          </div>
        </div>

        <div className="flex w-[400px] w-full flex-col gap-2">
          <div className="cursor-not-allowed text-lg leading-[22px] font-bold opacity-70">Disabled (Dark)</div>
          <Textarea.Input defaultValue="Disabled in dark mode" disabled />
        </div>
      </div>
    </div>
  )
}

// Composition Example
export const CompositionExample: Story = {
  render: function CompositionExampleRender() {
    const [bio, setBio] = useState('')

    return (
      <div className="flex w-[500px] w-full flex-col gap-2">
        <div className="text-lg leading-[22px] font-bold">
          <span className="mr-1 text-destructive">*</span>Profile Bio
        </div>
        <div className="relative">
          <Textarea.Input value={bio} onValueChange={setBio} placeholder="Tell us about yourself..." maxLength={500} />
          <Textarea.CharCount value={bio} maxLength={500} />
        </div>
        <div className="flex items-center gap-1.5 text-sm leading-4 text-foreground-tertiary">
          This will be displayed on your profile (max 500 characters)
        </div>
      </div>
    )
  }
}
