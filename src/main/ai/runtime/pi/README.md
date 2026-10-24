# Pi integration

`gatewayModelBinding.ts` registers a native Pi provider against Cherry's internal loopback gateway.
It supplies the model's protocol, limits, capabilities and gateway credentials to `ModelRuntime`.
The extracted runtime package receives that native model and runtime. Its desktop cutover is a later stack layer.

## Model requests

```text
Pi session → native Pi provider → internal gateway → Cherry provider execution
```

Pi owns context, streaming, reasoning replay, tools and compaction. Cherry's gateway owns provider
selection, upstream credentials and billing. Pi's native transcript remains the replay source;
product messages are a display projection. Tools advertised to the gateway have no executor there.

The binding preserves the model's native protocol when the gateway supports it. The model route
uses `providerId:apiModelId`; the gateway resolves it back to Cherry's product model. Internal usage
headers associate provider calls with the active Agent input. The internal listener works independently
of the externally exposed gateway setting.

Pi's session retry policy owns retry decisions. The native HTTP client and gateway do not add
retries. Native usage is for context and display; it must not create another billing record.
Model metadata, native errors and tool validation follow Pi's provider implementation. There is no
`ModelCallPort`, custom AI SDK stream protocol, metadata codec or implicit session requirement.

## Verification boundaries

`gatewaySession.test.ts` and `gatewayCompaction.test.ts` run real Pi sessions against a loopback
HTTP fixture using the production gateway converters and an AI SDK mock upstream. They cover
streaming, abort, tool ownership, session configuration and compaction. This fixture does not prove
provider selection, billing, live-provider acceptance or Electron integration; those need host tests.
