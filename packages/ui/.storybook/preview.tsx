import '../stories/tailwind.css'

import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react'

const preview: Preview = {
  parameters: {
    // A single "Theme" toggle drives everything: `withThemeByClassName` sets the `dark`
    // class and the wrapper below paints the matching `bg-background`/`text-foreground`.
    // The separate "Backgrounds" toolbar switch is disabled so there is only one control.
    backgrounds: { disable: true }
  },
  decorators: [
    withThemeByClassName({
      themes: {
        light: '',
        dark: 'dark'
      },
      defaultTheme: 'light'
    }),
    (Story) => (
      <div className="min-h-screen bg-background text-foreground">
        <Story />
      </div>
    )
  ]
}

export default preview
