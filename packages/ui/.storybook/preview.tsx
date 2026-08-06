import '../stories/tailwind.css'

import { DirectionProvider } from '@cherrystudio/ui'
import { withThemeByClassName } from '@storybook/addon-themes'
import type { Decorator, Preview } from '@storybook/react'
import { type ReactNode, useLayoutEffect } from 'react'

function DirectionPreview({ children, direction }: { children: ReactNode; direction: 'ltr' | 'rtl' }) {
  useLayoutEffect(() => {
    document.documentElement.lang = direction === 'rtl' ? 'ar' : 'en'
    document.documentElement.dir = direction
  }, [direction])

  return (
    <DirectionProvider dir={direction}>
      <div dir={direction}>{children}</div>
    </DirectionProvider>
  )
}

const withDirection: Decorator = (Story, context) => {
  const direction = context.globals.direction === 'rtl' ? 'rtl' : 'ltr'
  return (
    <DirectionPreview direction={direction}>
      <Story />
    </DirectionPreview>
  )
}

const preview: Preview = {
  globalTypes: {
    direction: {
      description: 'Layout direction',
      defaultValue: 'ltr',
      toolbar: {
        icon: 'transfer',
        items: [
          { value: 'ltr', title: 'LTR' },
          { value: 'rtl', title: 'RTL' }
        ],
        dynamicTitle: true
      }
    }
  },
  parameters: {
    backgrounds: {
      options: {
        light: { name: 'Light', value: 'hsla(0, 0%, 97%, 1)' },
        dark: { name: 'Dark', value: 'hsla(240, 6%, 10%, 1)' }
      }
    }
  },
  decorators: [
    withDirection,
    withThemeByClassName({
      themes: {
        light: '',
        dark: 'dark'
      },
      defaultTheme: 'light'
    })
  ]
}

export default preview
