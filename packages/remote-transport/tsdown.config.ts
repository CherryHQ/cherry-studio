import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], platform: 'neutral', dts: true, clean: true })
