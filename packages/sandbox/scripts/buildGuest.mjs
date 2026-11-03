import { build } from 'esbuild'
await build({
  entryPoints: ['src/diagnostics/guest.ts'],
  outfile: 'dist/diagnosticGuest.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24'
})
