import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { Calculator, Calendar, CreditCard, Settings, Smile, User } from 'lucide-react'
import { useEffect, useState } from 'react'

const meta: Meta<typeof Command> = {
  title: 'Components/Primitives/Command',
  component: Command,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A composable command menu built on top of `cmdk`. Supports search, groups, separators, keyboard shortcuts, and an optional dialog wrapper.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Command className="w-95 rounded-lg border shadow-md">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>
            <Calendar /> Calendar
          </CommandItem>
          <CommandItem>
            <Smile /> Search Emoji
          </CommandItem>
          <CommandItem>
            <Calculator /> Calculator
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <User /> Profile
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <CreditCard /> Billing
            <CommandShortcut>⌘B</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Settings /> Settings
            <CommandShortcut>⌘S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export const InDialog: Story = {
  render: function InDialogExample() {
    const [open, setOpen] = useState(false)

    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          setOpen((v) => !v)
        }
      }
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }, [])

    return (
      <div className="flex flex-col items-center gap-2">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open command palette
        </Button>
        <p className="text-xs text-muted-foreground">
          or press <CommandShortcut>⌘K</CommandShortcut>
        </p>
        <CommandDialog open={open} onOpenChange={setOpen}>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem onSelect={() => setOpen(false)}>
                <Calendar /> New event
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <User /> Invite member
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Settings /> Open settings
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </div>
    )
  }
}
