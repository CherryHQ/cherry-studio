import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    catalog: 'src/catalog.ts',
    'providers/zhipu': 'src/providers/zhipu.ts',
    'providers/tavily': 'src/providers/tavily.ts',
    'providers/searxng': 'src/providers/searxng.ts',
    'providers/exa': 'src/providers/exa.ts',
    'providers/exa-mcp': 'src/providers/exaMcp.ts',
    'providers/bocha': 'src/providers/bocha.ts',
    'providers/querit': 'src/providers/querit.ts',
    'providers/jina': 'src/providers/jina.ts',
    'providers/firecrawl': 'src/providers/firecrawl.ts',
    'providers/crawl4ai': 'src/providers/crawl4ai.ts',
    'providers/parallel': 'src/providers/parallel.ts',
    'providers/serply': 'src/providers/serply.ts',
    'providers/deepseek': 'src/providers/deepseek.ts',
    'tools/config': 'src/tools/config.ts',
    'tools/url-filter': 'src/tools/urlFilter.ts',
    'tools/content': 'src/tools/content.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  fixedExtension: true,
  platform: 'neutral',
  target: 'es2020',
  clean: true,
  dts: true,
  deps: { alwaysBundle: ['tokenx'] },
  tsconfig: 'tsconfig.json'
})
