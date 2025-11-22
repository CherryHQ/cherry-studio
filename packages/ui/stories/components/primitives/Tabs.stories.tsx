import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof Tabs> = {
  title: 'Components/Primitives/Tabs',
  component: Tabs,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A set of layered sections of content—known as tab panels—that are displayed one at a time. Based on shadcn/ui.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'line'],
      description: 'The visual style of the tabs'
    },
    defaultValue: {
      control: { type: 'text' },
      description: 'The value of the tab that should be active when initially rendered'
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Default (Segmented Control Style)
export const Default: Story = {
  render: () => (
    <Tabs defaultValue="account" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="account">
        <div className="rounded-md border p-4 mt-2">
          <h3 className="text-lg font-medium">Account</h3>
          <p className="text-sm text-muted-foreground">
            Make changes to your account here. Click save when you're done.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="password">
        <div className="rounded-md border p-4 mt-2">
          <h3 className="text-lg font-medium">Password</h3>
          <p className="text-sm text-muted-foreground">
            Change your password here. After saving, you'll be logged out.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  )
}

// Line Style (Figma)
export const LineStyle: Story = {
  render: () => (
    <Tabs defaultValue="tab1" variant="line" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        <TabsTrigger value="tab3">Tab 3</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <div className="p-4 mt-2 border rounded-md bg-muted/10">Content for Tab 1</div>
      </TabsContent>
      <TabsContent value="tab2">
        <div className="p-4 mt-2 border rounded-md bg-muted/10">Content for Tab 2</div>
      </TabsContent>
      <TabsContent value="tab3">
        <div className="p-4 mt-2 border rounded-md bg-muted/10">Content for Tab 3</div>
      </TabsContent>
    </Tabs>
  )
}

// Vertical
export const Vertical: Story = {
  render: () => (
    <Tabs defaultValue="music" orientation="vertical" variant="line" className="w-[400px]">
      <TabsList className="w-[120px]">
        <TabsTrigger value="music">Music</TabsTrigger>
        <TabsTrigger value="podcasts">Podcasts</TabsTrigger>
        <TabsTrigger value="live">Live</TabsTrigger>
      </TabsList>
      <TabsContent value="music" className="flex-1 p-4 border rounded-md bg-muted/10 mt-0">
        Music content
      </TabsContent>
      <TabsContent value="podcasts" className="flex-1 p-4 border rounded-md bg-muted/10 mt-0">
        Podcasts content
      </TabsContent>
      <TabsContent value="live" className="flex-1 p-4 border rounded-md bg-muted/10 mt-0">
        Live content
      </TabsContent>
    </Tabs>
  )
}

// With Icons
export const WithIcons: Story = {
  render: () => (
    <Tabs defaultValue="home" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="home" className="gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Home
        </TabsTrigger>
        <TabsTrigger value="settings" className="gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="home" className="mt-2">
        Home Content
      </TabsContent>
      <TabsContent value="settings" className="mt-2">
        Settings Content
      </TabsContent>
    </Tabs>
  )
}
