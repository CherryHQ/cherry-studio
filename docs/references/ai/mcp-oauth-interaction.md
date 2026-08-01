# MCP OAuth Interaction

MCP connections can begin either because the user is configuring a server or
because Cherry Studio is warming tool metadata in the background. Those two
cases have different authorization semantics even though both eventually call
the same MCP transport.

## Authorization modes

Every connection attempt has one of two modes:

| Mode | May reuse stored OAuth tokens | May open the system browser | Intended callers |
|---|---:|---:|---|
| `silent` | yes | no | app startup, agent-session prewarm, cold-cache refresh, version probes |
| `interactive` | yes | yes | existing MCP settings actions such as enabling, opening, or restarting a server |

`silent` is the default. A caller must opt in to `interactive`; a lower-level
transport must never infer user intent from the fact that authorization is
required.

This distinction does not add a new button, dialog, or preference. It preserves
the existing settings interactions while preventing a new session or another
background cache operation from unexpectedly switching to the browser.

## Connection flow

1. The caller selects an authorization mode and asks `McpRuntimeService` for a
   client.
2. The runtime passes that mode to `McpOAuthClientProvider` when it creates an
   HTTP transport.
3. The provider may load and refresh existing credentials in either mode.
4. If the remote server requires a new authorization grant:
   - `interactive` starts the loopback callback flow and opens the authorization
     URL in the system browser;
   - `silent` stops with an authorization-required error and leaves the browser
     untouched.

The runtime status may still become `error` after a silent attempt. That status
is diagnostic state, not permission to escalate the same attempt into an
interactive authorization flow.

## Call-site policy

Background paths must remain silent:

- `McpCatalogService.onReady()` prewarming active servers;
- cold-cache and explicit background tool-cache refreshes;
- agent-session runtime prewarming, including new-session mounts;
- passive metadata probes such as server-version loading.

Existing user-driven MCP settings paths may be interactive:

- enabling an MCP server from its settings card or detail page;
- opening an active server's detail page and refreshing its capabilities;
- saving and restarting an MCP server;

## Invariants

- The system browser opens only from an `interactive` request.
- Background work may consume a completed authorization but cannot initiate one.
- Tool-cache reads remain non-blocking and eventually consistent; an
  unauthorized server contributes no tools until an interactive authorization
  succeeds and the cache is refreshed.
- Authorization mode is request-scoped. It is not persisted as server state or
  a user preference.

## Verification

Tests should cover both sides of the boundary:

- a silent provider rejects a new authorization challenge without calling the
  browser opener;
- an interactive provider opens the authorization URL;
- background catalog/IPC calls select `silent`;
- user-driven settings calls select `interactive`.
