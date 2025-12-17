import { cn } from '@cherrystudio/ui/utils/index'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cva } from 'class-variance-authority'
import * as React from 'react'

const TabsContext = React.createContext<{
  variant?: 'default' | 'line'
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
  variant?: 'default' | 'line'
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
      default: 'bg-muted text-muted-foreground h-9 w-fit rounded-lg p-[3px]',
      line: 'bg-transparent gap-4 justify-start border-b-0 p-0'
    },
    orientation: {
      horizontal: 'flex-row',
      vertical: 'flex-col h-fit'
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
    'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium',
    'disabled:pointer-events-none disabled:opacity-50',
    'transition-all',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4'
  ],
  {
    variants: {
      variant: {
        default: [
          'h-[calc(100%-1px)] flex-1 gap-1.5 px-2 py-1 rounded-md',
          'text-foreground border border-transparent',
          'dark:text-muted-foreground',
          'focus-visible:ring-[3px] focus-visible:outline-1 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring',
          'data-[state=active]:bg-background data-[state=active]:shadow-sm',
          'dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30'
        ],
        line: [
          'relative gap-2 px-2 py-2',
          'font-normal text-muted-foreground hover:text-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'data-[state=active]:text-primary',
          'after:absolute after:bg-primary/10 after:rounded-full',
          'data-[state=active]:after:bg-primary'
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
          'hover:text-primary hover:bg-primary/10'
        ]
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
