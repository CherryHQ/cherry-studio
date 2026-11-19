import { serveUtilityProcess } from '../../../core/utilityProcess/runtime/serveUtilityProcess'
import type { TerminalHostContract, TerminalHostInit } from '../contracts'
import { TerminalHost } from './TerminalHost'

let host: TerminalHost
serveUtilityProcess<TerminalHostContract, TerminalHostInit>({
  id: 'terminal.host',
  initialize: (init, { logger }) => {
    host = new TerminalHost(init, logger)
  },
  handlers: {
    identity: () => host.init.host,
    mutate: (input) => host.mutate(input),
    operation: ({ host: identity, id }) => host.operation(identity, id),
    read: ({ host: identity, id, cursor, limit }) => host.read(identity, id, cursor, limit),
    release: ({ host: identity, id }) => host.release(identity, id),
    seal: ({ host: identity, admissionRevision }) => host.seal(identity, admissionRevision)
  },
  streams: { observe: (identity, context) => host.observe(identity, context) },
  dispose: async () => {
    await host.seal(host.init.host, Number.MAX_SAFE_INTEGER)
  }
})
