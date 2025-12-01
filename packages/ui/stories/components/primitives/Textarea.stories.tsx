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
    <Textarea.Root className="w-[400px]">
      <Textarea.Input placeholder="Type your message here..." />
    </Textarea.Root>
  )
}

// With Label
export const WithLabel: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <div className="text-lg font-bold leading-[22px]">Description</div>
      <Textarea.Input placeholder="Tell us about yourself..." />
    </Textarea.Root>
  )
}

// Required Field
export const RequiredField: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <div className="text-lg font-bold leading-[22px]">
        <span className="text-destructive mr-1">*</span>Bio
      </div>
      <Textarea.Input placeholder="This field is required..." />
    </Textarea.Root>
  )
}

// With Caption
export const WithCaption: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <div className="text-lg font-bold leading-[22px]">Comments</div>
      <Textarea.Input placeholder="Enter your comments..." />
      <div className="text-sm flex items-center gap-1.5 leading-4 text-foreground-muted">
        Please provide detailed feedback
      </div>
    </Textarea.Root>
  )
}

// Error State
export const ErrorState: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <div className="text-lg font-bold leading-[22px]">Message</div>
      <Textarea.Input placeholder="Enter your message..." hasError />
      <div className="text-sm flex items-center gap-1.5 leading-4 text-destructive">
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
    </Textarea.Root>
  )
}

// With Character Count
export const WithCharacterCount: Story = {
  render: function WithCharacterCountExample() {
    const [value, setValue] = useState('')

    return (
      <Textarea.Root className="w-[400px]">
        <div className="text-lg font-bold leading-[22px]">Tweet</div>
        <div className="relative">
          <Textarea.Input value={value} onValueChange={setValue} maxLength={280} placeholder="What's happening?" />
          <Textarea.CharCount value={value} maxLength={280} />
        </div>
        <div className="text-sm flex items-center gap-1.5 leading-4 text-foreground-muted">Maximum 280 characters</div>
      </Textarea.Root>
    )
  }
}

// Auto Resize (built-in via field-sizing-content)
export const AutoResize: Story = {
  render: function AutoResizeExample() {
    const [value, setValue] = useState('')

    return (
      <Textarea.Root className="w-[400px]">
        <div className="text-lg font-bold leading-[22px]">Auto-resizing Textarea</div>
        <Textarea.Input
          value={value}
          onValueChange={setValue}
          placeholder="This textarea grows with your content..."
        />
        <div className="text-sm flex items-center gap-1.5 leading-4 text-foreground-muted">
          Try typing multiple lines
        </div>
      </Textarea.Root>
    )
  }
}

// Disabled State
export const Disabled: Story = {
  render: () => (
    <Textarea.Root className="w-[400px]">
      <div className="text-lg font-bold leading-[22px] cursor-not-allowed opacity-70">Disabled Field</div>
      <Textarea.Input defaultValue="This textarea is disabled" disabled />
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
          <div className="text-lg font-bold leading-[22px]">Controlled Textarea</div>
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
            <div className="text-lg font-bold leading-[22px]">Default</div>
            <Textarea.Input value={value1} onValueChange={setValue1} placeholder="Enter text..." />
          </Textarea.Root>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Filled State</p>
          <Textarea.Root className="w-[400px]">
            <div className="text-lg font-bold leading-[22px]">Filled</div>
            <Textarea.Input value={value2} onValueChange={setValue2} />
          </Textarea.Root>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Disabled State</p>
          <Textarea.Root className="w-[400px]">
            <div className="text-lg font-bold leading-[22px] cursor-not-allowed opacity-70">Disabled</div>
            <Textarea.Input defaultValue="Disabled textarea with content" disabled />
          </Textarea.Root>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Error State</p>
          <Textarea.Root className="w-[400px]">
            <div className="text-lg font-bold leading-[22px]">Error</div>
            <Textarea.Input value={value4} onValueChange={setValue4} hasError />
            <div className="text-sm flex items-center gap-1.5 leading-4 text-destructive">
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
          </Textarea.Root>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">Focus State (click to focus)</p>
          <Textarea.Root className="w-[400px]">
            <div className="text-lg font-bold leading-[22px]">Focus</div>
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
          <Textarea.Root className="w-[500px]">
            <div className="text-lg font-bold leading-[22px]">What's happening?</div>
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
              <div className="text-sm flex items-center gap-1.5 leading-4 text-destructive">
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
          </Textarea.Root>
        </div>

        {/* Feedback Form */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">User Feedback</h3>
          <Textarea.Root className="w-[500px]">
            <div className="text-lg font-bold leading-[22px]">
              <span className="text-destructive mr-1">*</span>Feedback
            </div>
            <Textarea.Input
              value={feedback}
              onValueChange={setFeedback}
              placeholder="Please share your thoughts..."
              rows={4}
            />
            <div className="text-sm flex items-center gap-1.5 leading-4 text-foreground-muted">
              Your feedback helps us improve
            </div>
          </Textarea.Root>
        </div>

        {/* Contact Form */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Contact Us</h3>
          <Textarea.Root className="w-[500px]">
            <div className="text-lg font-bold leading-[22px]">
              <span className="text-destructive mr-1">*</span>Message
            </div>
            <Textarea.Input value={message} onValueChange={setMessage} placeholder="How can we help you?" rows={6} hasError={!!messageError} />
            {messageError ? (
              <div className="text-sm flex items-center gap-1.5 leading-4 text-destructive">
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
              <div className="text-sm flex items-center gap-1.5 leading-4 text-foreground-muted">
                Minimum 10 characters required
              </div>
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
          <div className="text-lg font-bold leading-[22px]">Default (Dark)</div>
          <Textarea.Input placeholder="Dark mode textarea..." />
        </Textarea.Root>

        <Textarea.Root className="w-[400px]">
          <div className="text-lg font-bold leading-[22px]">With Content (Dark)</div>
          <Textarea.Input defaultValue="This is some content in dark mode" />
        </Textarea.Root>

        <Textarea.Root className="w-[400px]">
          <div className="text-lg font-bold leading-[22px]">Error (Dark)</div>
          <Textarea.Input hasError />
          <div className="text-sm flex items-center gap-1.5 leading-4 text-destructive">
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
        </Textarea.Root>

        <Textarea.Root className="w-[400px]">
          <div className="text-lg font-bold leading-[22px] cursor-not-allowed opacity-70">Disabled (Dark)</div>
          <Textarea.Input defaultValue="Disabled in dark mode" disabled />
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
        <div className="text-lg font-bold leading-[22px]">
          <span className="text-destructive mr-1">*</span>Profile Bio
        </div>
        <div className="relative">
          <Textarea.Input
            value={bio}
            onValueChange={setBio}
            placeholder="Tell us about yourself..."
            maxLength={500}
          />
          <Textarea.CharCount value={bio} maxLength={500} />
        </div>
        <div className="text-sm flex items-center gap-1.5 leading-4 text-foreground-muted">
          This will be displayed on your profile (max 500 characters)
        </div>
      </Textarea.Root>
    )
  }
}
