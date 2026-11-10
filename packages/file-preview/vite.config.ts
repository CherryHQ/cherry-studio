import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import postcss from 'postcss'
import { dts } from 'rolldown-plugin-dts'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'))

export default defineConfig(({ mode }) => ({
  root,
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production') },
  resolve: {
    alias: [
      { find: /^@cherrystudio\/ui$/, replacement: resolve(root, 'src/bundledUi.ts') },
      { find: '@cherrystudio/ui', replacement: resolve(root, '../ui/src') }
    ]
  },
  plugins: [
    tailwindcss(),
    dts({ cwd: root, entry: ['src/core.ts', 'src/react.ts'], tsconfig: resolve(root, 'tsconfig.json') }),
    {
      name: 'file-preview-resources',
      async closeBundle() {
        const output = resolve(root, 'dist')
        await mkdir(resolve(output, 'assets'), { recursive: true })
        for (const directory of ['cmaps', 'standard_fonts']) {
          await cp(resolve(pdfjsRoot, directory), resolve(output, 'assets', directory), { recursive: true })
        }
        const stylesheet = resolve(output, 'styles.css')
        const css = postcss.parse(await readFile(stylesheet, 'utf8'))
        const animations = new Map<string, string>()
        css.walkAtRules((rule) => {
          if (rule.name === 'property') rule.params = rule.params.replace(/--tw-/g, '--fp-tw-')
          if (rule.name.endsWith('keyframes')) {
            animations.set(rule.params, `fp-${rule.params}`)
            rule.params = `fp-${rule.params}`
          }
        })
        css.walkDecls((declaration) => {
          declaration.prop = declaration.prop.replace(/--tw-/g, '--fp-tw-')
          declaration.value = declaration.value.replace(/--tw-/g, '--fp-tw-')
          for (const [name, scoped] of animations) {
            if (declaration.prop.startsWith('--animate-') || declaration.prop.startsWith('animation')) {
              declaration.value = declaration.value.replace(new RegExp(`\\b${name}\\b`, 'g'), scoped)
            }
          }
        })
        css.walkRules((rule) => {
          if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return
          if (rule.selector.includes('&')) return
          rule.selector = postcss.list
            .comma(rule.selector)
            .map((selector) => {
              if (selector === ':root' || selector === ':host') return ':where(.file-preview-root)'
              if (selector === '.dark') return ':where(.dark .file-preview-root, .file-preview-root.dark)'
              return selector.includes('.file-preview-root')
                ? selector
                : `:where(.file-preview-root):is(${selector}), :where(.file-preview-root) ${selector}`
            })
            .join(', ')
        })
        await writeFile(stylesheet, css.toString())
      }
    }
  ],
  oxc: { exclude: [/\.js$/, /\.d\.[cm]?ts$/] },
  build: {
    target: 'esnext',
    minify: false,
    cssMinify: false,
    lib: {
      entry: {
        core: resolve(root, 'src/core.ts'),
        react: resolve(root, 'src/react.ts'),
        styles: resolve(root, 'src/styles.ts')
      },
      formats: ['es'],
      fileName: '[name]',
      cssFileName: 'styles'
    },
    rolldownOptions: {
      external: (id) => /^(react|react-dom|zod)(\/|$)/.test(id),
      output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' }
    }
  },
  worker: {
    format: 'es',
    rolldownOptions: {
      output: {
        entryFileNames: (chunk) =>
          chunk.name.includes('xlsxParser') ? 'assets/xlsx.worker.js' : 'assets/pdf.worker.js',
        chunkFileNames: 'assets/[name]-[hash].js'
      }
    }
  }
}))
