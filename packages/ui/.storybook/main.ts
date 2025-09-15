import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../stories/components/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: '@storybook/react-vite',
  viteFinal: async (config) => {
    const { mergeConfig } = await import('vite')
    // 动态导入 @tailwindcss/vite 以避免 ESM/CJS 兼容性问题
    const tailwindPlugin = (await import('@tailwindcss/vite')).default
    return mergeConfig(config, {
      plugins: [tailwindPlugin()]
    })
  }
}

export default config
