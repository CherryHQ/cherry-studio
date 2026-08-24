import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'
import { dirname, resolve } from 'path'

const config: StorybookConfig = {
  stories: ['../stories/components/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: [getAbsolutePath('@storybook/addon-docs'), getAbsolutePath('@storybook/addon-themes')],
  framework: getAbsolutePath('@storybook/react-vite'),
  viteFinal: async (config) => {
    const { mergeConfig } = await import('vite')
    const tailwindPlugin = (await import('@tailwindcss/vite')).default
    return mergeConfig(config, {
      plugins: [tailwindPlugin()],
      resolve: {
        alias: {
          '@cherrystudio/ui': resolve('src')
        }
      }
    })
  }
}

export default config

function getAbsolutePath(value: string): any {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)))
}
