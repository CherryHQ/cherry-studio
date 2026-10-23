# Pi integration

`PiRuntimeConnection` connects desktop root sessions through `createPiRuntime` from
`@cherrystudio/agent-runtime-pi`. Cherry owns product messages and branch bindings; Pi owns
native history and execution. The connection installs shared `agent-behavior` rules through production
`HostPorts` and observes each live child independently. Durable desktop integration remains separate work.

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

The behavior adapter disables native retries; the native HTTP client and gateway do not add retries.
Native usage is for context and display; it must not create another billing record. Only root model
calls emit native usage updates on the root stream; child, summary and verifier calls still contribute
to gateway billing. Product message totals use the gateway's aggregated provider calls.
Model metadata, native errors and tool validation follow Pi's provider implementation. There is no
`ModelCallPort`, custom AI SDK stream protocol, metadata codec or implicit session requirement.

## Host ports

`piBehaviorHost.ts` connects shared behavior to the existing approval registry, question cards, model
catalog, native Pi model binding and output files. `piApprovalFacts.ts` collects tool, workspace and
interaction facts; `agent-behavior` decides permission policy. Cross-session delegation still requires
an interactive user turn. Child tools use the root's live agent policy.

Approval and question identities use `CallRef`. The Pi facet resolves these opaque keys to native
`toolCallId` values for cards, including nested calls. Persisted approval outcomes are read from the
existing message parts; pending questions do not resume after restart. No new database table is used.

Compaction calls the host summarizer once through the native gateway binding; goal completion calls
the verifier through the same path without a tool loop. Empty or failed summaries cancel compaction.
`agent-behavior` provides `vcc_recall`; the old pi-vcc extension and build artifact are removed.
Large tool output is saved under `feature.agents.outputs`, which read tools may access.

## Desktop ownership

`ThreadProjection` converts ordered runtime items into UI chunks. A snapshot establishes its baseline;
it never replays recovered content into the product archive. Tool items use the Pi facet's opaque
lookup and the existing tool renderer. Child output maps to its native spawn call in the existing
background-flow transport. Goal rounds and background delivery announce autonomous turn boundaries.
Observation loss fails the turn and retires the owner.

`PiRuntimeConnection` remains the bridge to `AgentSessionRuntimeService`: it owns product input
persistence, branch bindings, UI chunks, trace context and configuration reconciliation. Retiring the
class requires moving those consumers to `ThreadHandle`; installing behavior alone does not remove it.

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

Native session, goal and subagent tests live in `packages/agent-runtime-pi/tests/`. They use Pi
providers directly, including scripted native streams with fixed usage for budget assertions.
`gatewayIntegration.test.ts` exercises real gateway
execution, provider selection, request options, cancellation and SQLite billing against a loopback upstream.
`PiRuntimeConnection.test.ts` covers desktop connection ownership and native context associations
with a native test provider substituted at the model-binding boundary.
Live-provider and Electron acceptance remain separate checks.
