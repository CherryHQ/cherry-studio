// zod probes `Function('')` to compile faster parsers; the CSP forbids eval, so it must not try.
// Imported first by the page and the Worker, before any schema parses.
import { config } from 'zod'

config({ jitless: true })
