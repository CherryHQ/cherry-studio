// Keep normal application imports behind the SDK hook: hooks must not open user data.
async function start(): Promise<void> {
  if (__VELOPACK__) {
    try {
      const { VelopackApp } = await import('velopack')
      VelopackApp.build().setAutoApplyOnStartup(false).run()
    } catch (error) {
      if (process.argv.some((arg) => arg.startsWith('--veloapp-'))) throw error
      process.env.CHERRY_VELOPACK_UNAVAILABLE = '1'
      process.stderr.write('Velopack could not initialize; updates are unavailable.\n')
    }
  }
  await import('@main/main')
}

void start().catch((error: unknown) => {
  process.stderr.write(`Application startup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exit(1)
})
