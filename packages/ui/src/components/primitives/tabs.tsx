import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

const TabsContext = React.createContext<{
  variant?: 'default' | 'line' | 'underline' | 'workflow'
  orientation?: 'horizontal' | 'vertical'
}>({
  variant: 'default',
  orientation: 'horizontal'
})

function Tabs({
  className,
  variant = 'default',
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & {
  variant?: 'default' | 'line' | 'underline' | 'workflow'
}) {
  return (
    <TabsContext value={{ variant, orientation }}>
      <TabsPrimitive.Root
        data-slot="tabs"
        orientation={orientation}
        className={cn('flex flex-col gap-2', orientation === 'vertical' && 'flex-row', className)}
        {...props}
      />
    </TabsContext>
  )
}

const tabsListVariants = cva('inline-flex items-center justify-center', {
  variants: {
    variant: {
      default: 'h-9 w-fit rounded-lg bg-muted p-[3px] text-muted-foreground',
      line: 'justify-start gap-4 border-b-0 bg-transparent p-0',
      underline: 'justify-start gap-0 border-b-0 bg-transparent p-0',
      workflow: 'justify-start gap-3 border-b-0 bg-transparent p-0'
    },
    orientation: {
      horizontal: 'flex-row',
      vertical: 'h-fit flex-col'
    }
  },
  compoundVariants: [
    {
      variant: 'default',
      orientation: 'vertical',
      class: 'h-fit w-fit flex-col'
    },
    {
      variant: 'line',
      orientation: 'vertical',
      class: 'flex-col items-stretch pb-0'
    }
  ],
  defaultVariants: {
    variant: 'default',
    orientation: 'horizontal'
  }
})

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const { variant, orientation } = React.use(TabsContext)
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(tabsListVariants({ variant, orientation }), className)}
      {...props}
    />
  )
}

const tabsTriggerVariants = cva(
  [
    'inline-flex items-center justify-center text-sm font-medium whitespace-nowrap',
    'disabled:pointer-events-none disabled:opacity-50',
    'transition-all outline-none',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4'
  ],
  {
    variants: {
      variant: {
        default: [
          'h-[calc(100%-1px)] flex-1 gap-1.5 rounded-md px-2 py-1',
          'border border-transparent text-foreground',
          'dark:text-muted-foreground',
          'focus-visible:border-primary focus-visible:bg-accent',
          'data-[state=active]:bg-background data-[state=active]:shadow-sm',
          'dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground'
        ],
        line: [
          'relative gap-2 px-2 py-2',
          'font-normal text-muted-foreground hover:text-foreground',
          'focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-4',
          'data-[state=active]:text-primary',
          'after:absolute after:rounded-full after:bg-transparent',
          'data-[state=active]:after:bg-primary'
        ],
        underline: [
          'relative gap-1.5 px-2.5 py-2',
          'font-normal text-muted-foreground hover:text-foreground',
          'focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-4',
          'data-[state=active]:text-foreground',
          'after:absolute after:rounded-none after:bg-transparent',
          'data-[state=active]:after:bg-primary'
        ],
        workflow: [
          'relative gap-1.5 px-1 py-1.5 text-sm font-normal',
          'text-muted-foreground hover:text-foreground',
          'rounded-sm focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-4',
          'data-[state=active]:font-semibold data-[state=active]:text-foreground',
          'data-[state=active]:underline data-[state=active]:decoration-1 data-[state=active]:underline-offset-4',
          "[&:not(:first-child)]:before:content-['›']",
          '[&:not(:first-child)]:before:mr-3 [&:not(:first-child)]:before:text-base',
          '[&:not(:first-child)]:before:font-normal [&:not(:first-child)]:before:no-underline',
          '[&:not(:first-child)]:before:text-muted-foreground'
        ]
      },
      orientation: {
        horizontal: '',
        vertical: 'rounded-full'
      }
    },
    compoundVariants: [
      {
        variant: 'line',
        orientation: 'horizontal',
        class: 'after:bottom-0 after:left-0 after:h-[2px] after:w-full data-[state=active]:after:h-[4px]'
      },
      {
        variant: 'line',
        orientation: 'vertical',
        class: [
          'justify-center after:bottom-0 after:left-0 after:h-[4px] after:w-full after:bg-transparent data-[state=active]:after:bg-primary',
          'hover:bg-primary/10 hover:text-primary'
        ]
      },
      {
        variant: 'underline',
        orientation: 'horizontal',
        class: 'after:bottom-0 after:left-0 after:h-0.5 after:w-full'
      }
    ],
    defaultVariants: {
      variant: 'default',
      orientation: 'horizontal'
    }
  }
)

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const { variant, orientation } = React.use(TabsContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant, orientation }), className)}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
