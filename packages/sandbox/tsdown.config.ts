import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      'host/SandboxManager': 'src/host/SandboxManager.ts',
      types: 'src/types.ts',
      'rpc/peer': 'src/rpc/peer.ts',
      'diagnostics/run': 'src/diagnostics/run.ts',
      'cli/lab': 'src/cli/lab.ts'
    },
    format: ['esm'],
    platform: 'node',
    target: 'node24',
    dts: true,
    clean: true
  },
  {
    entry: { diagnosticGuest: 'src/diagnostics/guest.ts' },
    format: ['cjs'],
    platform: 'node',
    target: 'node24',
    deps: { alwaysBundle: [/.*/] },
    dts: false,
    clean: false
  }
])
