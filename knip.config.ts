import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: [
    'src/main/index.ts',
    'src/preload/index.ts',
    'src/renderer/src/entryPoint.tsx',
    'src/renderer/src/windows/mini/entryPoint.tsx',
    'src/renderer/src/windows/selection/action/entryPoint.tsx',
    'src/renderer/src/windows/selection/toolbar/entryPoint.tsx',
    'src/renderer/src/trace/traceWindow.tsx',
    'electron.vite.config.ts'
  ],
  project: ['src/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'scripts/**/*.ts'],
  ignore: [
    'scripts/**',
    '**/__tests__/**',
    'packages/aiCore/setupVitest.ts',
    'src/main/electron.d.ts',
    'src/main/env.d.ts',
    'src/preload/preload.d.ts',
    'src/renderer/src/env.d.ts',
    'src/renderer/src/types/electron.d.ts',
    'src/renderer/src/types/nutstore.d.ts'
  ]
}

export default config
