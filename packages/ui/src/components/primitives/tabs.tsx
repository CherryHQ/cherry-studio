import { cn } from '@cherrystudio/ui/lib/utils'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cva } from 'class-variance-authority'
import * as React from 'react'

const TabsContext = React.createContext<{
  variant?: 'default' | 'line' | 'underline' | 'workflow'
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'default' | 'lg'
}>({
  variant: 'default',
  orientation: 'horizontal',
  size: 'default'
})

function Tabs({
  className,
  variant = 'default',
  orientation = 'horizontal',
  size = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & {
  variant?: 'default' | 'line' | 'underline' | 'workflow'
  size?: 'sm' | 'default' | 'lg'
}) {
  return (
    <TabsContext value={{ variant, orientation, size }}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-size={size}
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
      default: 'w-fit rounded-lg bg-muted text-muted-foreground',
      line: 'bg-transparent gap-4 justify-start border-b-0 p-0',
      underline: 'bg-transparent gap-0 justify-start border-b-0 p-0',
      workflow: 'bg-transparent gap-3 justify-start border-b-0 p-0'
    },
    orientation: {
      horizontal: 'flex-row',
      vertical: 'flex-col h-fit'
    },
    size: {
      sm: '',
      default: '',
      lg: ''
    }
  },
  compoundVariants: [
    {
      variant: 'default',
      orientation: 'horizontal',
      size: 'sm',
      class: 'h-8 p-0.5'
    },
    {
      variant: 'default',
      orientation: 'horizontal',
      size: 'default',
      class: 'h-9 p-[3px]'
    },
    {
      variant: 'default',
      orientation: 'horizontal',
      size: 'lg',
      class: 'h-10 p-1'
    },
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
    orientation: 'horizontal',
    size: 'default'
  }
})

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const { variant, orientation, size } = React.use(TabsContext)
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-size={size}
      className={cn(tabsListVariants({ variant, orientation, size }), className)}
      {...props}
    />
  )
}

const tabsTriggerVariants = cva(
  [
    'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium',
    'disabled:pointer-events-none disabled:opacity-50',
    'transition-all outline-none',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4'
  ],
  {
    variants: {
      variant: {
        default: [
          'h-[calc(100%-1px)] flex-1 gap-1.5 px-2 py-1 rounded-md',
          'text-foreground border border-transparent',
          'dark:text-muted-foreground',
          'focus-visible:border-primary focus-visible:bg-accent',
          'data-[state=active]:bg-background data-[state=active]:shadow-sm',
          'dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30'
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
          'data-[state=active]:text-foreground data-[state=active]:font-semibold',
          'data-[state=active]:underline data-[state=active]:underline-offset-4 data-[state=active]:decoration-1',
          "[&:not(:first-child)]:before:content-['›']",
          '[&:not(:first-child)]:before:mr-3 [&:not(:first-child)]:before:text-base',
          '[&:not(:first-child)]:before:font-normal [&:not(:first-child)]:before:no-underline',
          '[&:not(:first-child)]:before:text-muted-foreground'
        ]
      },
      orientation: {
        horizontal: '',
        vertical: 'rounded-full'
      },
      size: {
        sm: '',
        default: '',
        lg: ''
      }
    },
    compoundVariants: [
      {
        variant: 'default',
        size: 'sm',
        class: 'gap-1 px-2 py-0.5 text-xs'
      },
      {
        variant: 'default',
        size: 'default',
        class: 'gap-1.5 px-2 py-1 text-sm'
      },
      {
        variant: 'default',
        size: 'lg',
        class: 'gap-2 px-3 py-1.5 text-sm'
      },
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
      },
      {
        variant: 'underline',
        orientation: 'horizontal',
        class: 'after:bottom-0 after:left-0 after:h-0.5 after:w-full'
      }
    ],
    defaultVariants: {
      variant: 'default',
      orientation: 'horizontal',
      size: 'default'
    }
  }
)

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const { variant, orientation, size } = React.use(TabsContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-size={size}
      className={cn(tabsTriggerVariants({ variant, orientation, size }), className)}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
