# Pi integration

`PiRuntimeConnection` connects desktop root sessions through `createPiRuntime` from
`@cherrystudio/agent-runtime-pi`. Cherry owns product messages and branch bindings; Pi owns
native history, execution, and compaction. Independent desktop child projections and Durable
desktop integration remain separate work.

The Pi adapter is a production dependency loaded with dynamic `import()`. Keep its ESM-only native
dependencies outside the bundled CommonJS Main entry; a static import fails during Electron startup.

## Model requests

```text
Pi session → native Pi provider → internal gateway → Cherry provider execution
```

Pi owns context, streaming, reasoning replay, tools and compaction. Cherry's gateway owns provider
selection, upstream credentials and billing. Pi's native transcript remains the replay source;
product messages are a display projection. Tools advertised to the gateway have no executor there.

The binding preserves the model's native protocol when the gateway supports it. The model route
uses `providerId:apiModelId`; the gateway resolves the configured Cherry model. Internal usage
headers associate provider calls with the active Agent input. The internal listener works independently
of the externally exposed gateway setting. Its origin participates in the connection signature, so
a listener restart retires warm connections. Trusted headers carry reasoning, tier and Fast selections
to the same Cherry parameter builder used by other requests.

Pi's session retry policy owns retry decisions. The native HTTP client and gateway do not add
retries. Native usage is for context and display; it must not create another billing record.
Model metadata, native errors and tool validation follow Pi's provider implementation. There is no
`ModelCallPort`, custom AI SDK stream protocol, metadata codec or implicit session requirement.

## Desktop ownership

`ThreadProjection` converts ordered runtime items into UI chunks. A snapshot establishes its baseline;
it never replays recovered content into the product archive. Tool items use the Pi facet's opaque
lookup and the existing tool renderer. Observation loss fails the turn and retires the owner.

Before dispatch, Main records submission identity and facts on the existing user row. Native placement
and settlement update those facts; final assistant persistence commits response associations in the
same database transaction. Attachments retain Cherry's existing file-path input representation.

A root opens only the native identity bound to its captured product branch. Confirmed or previously
submitted contexts require one existing, identity-checked file. Only a never-submitted creation intent
may have no file yet; Pi flushes lazily and Cherry publishes its resume token after that evidence.
There is no reconstruction from product messages. The connection stays owned while idle until explicit
retirement or application shutdown; stopping aborts native work and flushes observed input facts.
Queued inputs Pi never placed are marked aborted and are not automatically resent after a stop/error.

## Verification boundaries

`gatewaySession.test.ts` and `gatewayCompaction.test.ts` run real Pi sessions against a loopback
HTTP fixture using the production gateway converters and an AI SDK mock upstream. They cover
streaming, abort, tool ownership, session configuration and compaction. This fixture does not prove
provider selection, billing or Electron integration. `gatewayIntegration.test.ts` exercises real gateway
execution, provider selection, request options, cancellation and SQLite billing against a loopback upstream.
`PiRuntimeConnection.test.ts` covers desktop connection ownership and native context associations.
Live-provider and Electron acceptance remain separate checks.
