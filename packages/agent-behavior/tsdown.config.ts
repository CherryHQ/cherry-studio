import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], platform: 'node', dts: true, clean: true })
