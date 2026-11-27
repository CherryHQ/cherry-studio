import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    agent: 'src/agent.ts',
    configuration: 'src/configuration.ts',
    failure: 'src/failure.ts'
  },
  format: ['esm'],
  dts: true,
  clean: true,
  platform: 'neutral'
})
