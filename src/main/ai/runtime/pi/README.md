# Pi integration

`PiRuntimeConnection` connects desktop root sessions through `createPiRuntime` from
`@cherrystudio/agent-runtime-pi`. Cherry owns product messages and branch bindings; Pi owns
native history and execution. The connection installs shared `agent-behavior` rules through production
`HostPorts` and observes each live child independently. The
[Durable desktop driver](../piDurable/README.md) reuses the gateway binding, behavior
host, approval facts, shell helpers and tool renderer with its own native owner.

The Pi adapter is a production dependency loaded with dynamic `import()`. Keep its ESM-only native
dependencies outside the bundled CommonJS Main entry; a static import fails during Electron startup.

## Model requests

```text
Pi session → native Pi provider → internal gateway → Cherry provider execution
```

Pi owns context, streaming, reasoning replay, tools and compaction. Cherry's gateway owns provider
selection, upstream credentials and billing. Pi's native transcript remains the replay source;
product messages are a display projection. Tools advertised to the gateway have no executor there.

Pi and Pi Durable use one gateway compatibility predicate for model selection, child catalogs and
native binding. The desktop binding receives only an internal gateway credential; upstream API keys,
OAuth refresh and provider request patches stay in Cherry's provider execution. There is no desktop
direct-provider route or Pi-specific OAuth stream wrapper.

Executable child candidates require both the model and its provider to be enabled. The gateway
still validates availability for each request after selection.

The binding preserves the model's native protocol when the gateway supports it. The model route
uses `providerId:apiModelId`; the gateway resolves the configured Cherry model. Internal usage
headers capture the Agent session; native response IDs associate completed calls with root or child messages. The internal listener works independently
of the externally exposed gateway setting. Its origin participates in the connection signature, so
a listener restart retires warm connections. Trusted headers carry reasoning, tier and Fast selections
to the same Cherry parameter builder used by other requests.

The behavior adapter disables native retries; the native HTTP client and gateway do not add retries.
Native usage is for context and display; it must not create another billing record. Only root model
calls emit native usage updates on the root stream; child, summary and verifier calls still contribute
to gateway billing. Desktop-owned summaries freeze their initiating owner before the gateway hop. Product message totals use the gateway's aggregated provider calls.
Model metadata, native errors and tool validation follow Pi's provider implementation. There is no
`ModelCallPort`, custom AI SDK stream protocol, metadata codec or implicit session requirement.

## Telemetry

Model traces come from the gateway's AI SDK and HTTP instrumentation. The binding forwards
an explicit native Durable phase parent using the gateway's internal usage capture; it creates
no model span and writes no billing record. Ordinary Pi 1.5.0 has no native tool-span API,
so tool details remain in its transcript. The host does not reconstruct tool spans from message events.

The desktop connection classifies native input outcomes before forwarding failures. Cancellation,
output limits and known provider failures remain local; unexpected runtime and projection failures
remain eligible for error reporting. Capture ownership follows the original error through the
terminal event, so the outer session boundary cannot report it again.
Manual compaction's original thrown error inherits capture ownership only when the runtime
identifies the matching root's failed compaction event. Post-compaction callback failures and
unrelated background errors remain separate reporting candidates.

## Host ports

`piBehaviorHost.ts` connects shared behavior to the existing approval registry, question cards, model
catalog, native Pi model binding and output files. `piApprovalFacts.ts` collects tool, workspace and
interaction facts; `agent-behavior` decides permission policy. Cross-session delegation still requires
an interactive user turn. Root and child threads use the root's live agent permission mode,
interaction state and tool restrictions; delegation never grants `bypassPermissions`.

Approval and question identities use `CallRef`. The Pi facet resolves these opaque keys to native
`toolCallId` values for cards, including nested calls. Persisted approval outcomes are read from the
existing message parts; pending questions do not resume after restart. No new database table is used.

Pi and Pi Durable generate compaction summaries using their native runtimes. Each native summary request is
metered, and its reported usage is attributed to the initiating goal and child run. The gateway remains the sole
writer of provider billing records. Goal completion calls the verifier through the gateway without a tool loop.

Ordinary Pi receives model-specific compaction thresholds from its gateway binding, including child model
overrides. Below a 100,000-token context, the Pi package bounds summary input/output through its native
extension and cancels failed summaries without retry or fallback. Larger contexts keep native summary
behavior. Pi Durable uses its own native compaction path and is outside this budget change. The package
[compaction contract](../../../../../packages/agent-runtime-pi/README.md#compaction-and-shared-tools)
owns summary execution details.
`agent-behavior` provides `vcc_recall`; the old pi-vcc extension and build artifact are removed.
Large tool output is saved under `feature.agents.outputs`, which read tools may access.

## Desktop ownership

`ThreadMessageProjection` receives authoritative SDK messages from the runtime adapter. Main applies
tool display metadata, and `RootMessageProjection` groups native messages into product replies without
a second SDK reader. Child output uses an independent `ChildThreadProjection` and product archive;
the parent reply carries task-card metadata. Goal rounds and background delivery announce autonomous
turn boundaries.
Observation loss fails the turn and retires the owner.

Closing an active session records user-stop for the root and its children before owner shutdown.
After the product archive is trashed or deleted, close goes directly through owner shutdown,
which aborts and drains native work without reading the removed approval history.

`PiRuntimeConnection` remains the bridge to `AgentSessionRuntimeService`: it owns product input
persistence, branch bindings, message views, trace context and configuration reconciliation. Retiring the
class requires moving those consumers to `ThreadHandle`; installing behavior alone does not remove it.

Before dispatch, Main binds the existing user row to its native context; placement adds the native
input entry ID. Input outcomes remain in the live runtime projection; Main owns product reply
identity and joins billing through native response identity.
Saving an assistant row confirms its branch binding and stores its resume token and checkpoint in
the same transaction. Attachments retain Cherry's existing file-path input representation.

A root opens only the native identity bound to its captured product branch. Confirmed or previously
submitted contexts require one existing, identity-checked file. Only a never-submitted creation intent
may have no file yet; Pi flushes lazily, except that locally handled commands explicitly persist
their native state before acknowledgement. Cherry publishes its resume token after native persistence.
There is no reconstruction from product messages. The connection stays owned while idle until explicit
retirement or application shutdown; stopping cancels native execution and manual compaction before
waiting for admission to finish. Queued inputs Pi never placed are marked aborted in the live projection
and are not automatically resent after a stop/error. Startup terminalizes Pi's abandoned product
placeholders while preserving native bindings and history; delivery recovery owns persisted delivery turns.

Child projection consumes the public `ThreadHandle` and committed content supplied by the connection.
It never imports Pi types or dispatches input. The connection reads the typed `pi.archive()` facet,
which proves native entry/live-message aliases and excludes inherited parent context, and submits child
input through its native owner. Archive messages use the existing shared message model, with stable
product IDs and source mappings saved atomically. IPC sends a snapshot on attach and ordered patches
afterward; detaching a window leaves the native observer and archive writer alive.
An attachment during child creation waits for its native projection, including pending model
configuration. Terminal tool output or owner/turn completion ends an unavailable child's wait.

Backup/restore seals child-input admission in `AgentSessionRuntimeService`. After admitted inputs
return, `drainChildWrites()` waits for the shared native behavior and its reporting jobs through
`pi.settled()`, then refreshes child archives. A submission acknowledgement alone does not establish
that writes have ended. A failed archive flush rejects the drain and can be retried.

Reopening a parent restores identity-checked child files without starting work. Missing owners leave
saved child output readable. A restored parent's stop policy still applies to child continuation;
an independent archive is never a writable root. Shutdown quiesces native execution, reconciles
committed child history while its access remains readable, and releases access after archive flush.

## Verification boundaries

Native session, goal and subagent tests live in `packages/agent-runtime-pi/tests/`. They use Pi
providers directly, including scripted native streams with fixed usage for budget assertions.
`gatewayIntegration.test.ts` exercises real gateway
execution, provider selection, request options, cancellation and SQLite billing against a loopback upstream.
`PiRuntimeConnection.test.ts` covers desktop connection ownership and native context associations
with a native test provider substituted at the model-binding boundary.
Live-provider and Electron acceptance remain separate checks.

### Focused small-context regressions

Run from the repository root:

```bash
pnpm exec vitest run --project agent-runtime-pi packages/agent-runtime-pi/tests/compactionSummary.test.ts packages/agent-runtime-pi/tests/behaviorRuntime.test.ts packages/agent-runtime-pi/tests/sessionEvents.test.ts
pnpm exec vitest run --project main src/main/ai/runtime/pi/piCompactionRecovery.test.ts src/main/ai/runtime/pi/piCompactionBudget.test.ts src/main/ai/runtime/pi/gatewayModelBinding.test.ts src/main/ai/runtime/pi/PiRuntimeConnection.test.ts
```

These cover summary fitting and failure, child request limits and usage, per-model thresholds, post-compaction
output estimates, gateway bindings and desktop manual compaction. They use scripted providers and a loopback
upstream; the following live-provider check is separate.

### Manual small-context Pi check

Use an [isolated development profile](../../../../../docs/dev/contrib/development.md#start) and synthetic
conversation text. The current New Agent wizard creates
`pi-durable` agents and the edit dialog displays a read-only runtime. Creating an agent in that wizard does
not exercise the ordinary Pi adapter. For this developer check, use the same supported `ai.agent.create`
IPC command as `tests/e2e/smoke/piStoreOmission.test.ts`, with an explicit `type: 'pi'`.

1. In Settings → Providers, configure an enabled test provider and a gateway-compatible text model with its
   real upstream model ID. Give the model the display name `Pi compaction QA 8K`. In its model edit drawer,
   type `8192` into Context Window and `1024` into Max Output Tokens; leave each field to commit the value.
   The preset buttons start above 8K, so use the numeric inputs. This is a local catalog limit for the test;
   it does not change the provider's real capacity. Do not use a CLI-only provider or change a production model.
2. In that development window's DevTools console, create a dedicated Pi agent and system-workspace session:

   ```javascript
   await (async () => {
     const listed = await window.api.dataApi.request({
       id: 'pi-qa-models', method: 'GET', path: '/models', query: { enabled: true }
     })
     if (listed.status !== 200) throw new Error('Could not list test models')
     const matches = listed.data.filter((model) => model.name === 'Pi compaction QA 8K')
     if (matches.length !== 1) throw new Error('Create exactly one named test model')
     const model = matches[0]
     if (model.contextWindow !== 8192 || model.maxOutputTokens !== 1024)
       throw new Error('Commit the 8K context and 1K output limits first')
     const name = `Pi compaction QA ${Date.now()}`
     const created = await window.api.ipcApi.request('ai.agent.create', {
       type: 'pi', name, model: model.id,
       instructions: 'Answer briefly without tools. Preserve the objective and progress markers.'
     })
     if (!created.ok || created.data.type !== 'pi') throw new Error('Ordinary Pi was not created')
     const session = await window.api.dataApi.request({
       id: 'pi-qa-session', method: 'POST', path: '/agent-sessions',
       body: { agentId: created.data.id, name, workspace: { type: 'system' } }
     })
     if (session.status !== 201) throw new Error('Could not create test session')
     return { name, runtime: created.data.type }
   })()
   ```

3. Refresh the development window, open Work and select the returned agent/session name. Its runtime must
   read Pi, not Pi Durable or Claude Code. Send synthetic turns with `ORIGINAL_TASK` near the beginning and
   `LATEST_PROGRESS` at the end, then submit `/compact Keep ORIGINAL_TASK and LATEST_PROGRESS.` If the history
   is too short to compact, add synthetic text and repeat. Record the actual native compaction completion
   and the new compaction entry in this test session's JSONL; two successful chat turns alone are not acceptance.
4. Ask for the two markers after compaction, then reopen the session and ask again. Inspect the captured test
   summary request to confirm bounded input/output and complete focus instructions. Never attach provider
   credentials or unrelated conversation content to the result. Manual `/compact` verifies the summary path;
   automatic triggering requires a separate run that grows history past the configured threshold.
5. Use the focused regressions for deterministic overflow, impossible instruction budgets, unsuccessful
   responses and child-model budget changes. A provider may not produce those failures during a manual run.
   Report the tested commit, runtime, configured limits and observed result; this procedure is not a claim
   that a live-provider or packaged-app run has already passed.
