# MCP servers

Covers `mcp__mcp-manager__install_mcp_server` — registering a new MCP server in Cherry
and binding it to the current agent.

Get exact argument shapes from the live tool schema — this reference gives routing,
sequencing, and safety only.

## Availability

Present for agents that compose with the user's environment. Absent for sealed built-in
agents (Cherry Support), where registering servers is not available this session.

## Approval

`mcp__mcp-manager__install_mcp_server` mutates durable state and is **approval-gated**.
For a `stdio` server the config you pass *is* a local command line: `command` + `args`
launch a real process on the user's machine with the `env` you supply. Install only once
the user has signaled intent; if approval is declined, stop and report — don't register
the server by editing settings files or shelling out.

## Never invent a config

Unlike a skill's opaque `install_source`, here **you author the whole config** — so a
hallucinated package name or endpoint becomes a real command or a real request. Install
only a config the user pasted, linked, or explicitly confirmed. If you are working from
a server's documentation, show the user the exact config you are about to register and
get confirmation first. Never guess a `command`, an `args` package name, or a `baseUrl`.

`env` and `headers` typically carry API keys. Take them from the user; never fabricate a
placeholder and never echo a secret back in full.

## Workflow

1. **Get the config from the user** — `stdio` (local process) needs `command`; `sse` and
   `streamableHttp` (remote) need `baseUrl`. `name` is required for all three.
2. **Confirm, then call** with `activate` omitted. The server is registered **inactive
   and untrusted**, bound to this agent, for the user to enable in Settings → MCP.
3. **Only if the user explicitly asks to turn it on now**, pass `activate: true` — that
   marks it active and trusted and starts it, so its tools appear on the next tool
   re-list without a restart.

Report which of the two happened. A registered-but-inactive server runs nothing yet;
telling the user their tools are live when they are not sends them debugging a
non-problem.

## Recovery

- **Tool error result** (missing `command`/`baseUrl`, rejected field, duplicate name) →
  read the message and correct that field; don't retry the same arguments, and don't
  fall back to editing MCP settings by hand.
- **Approval declined** → stop and report; don't register through another route.

## Example

> "Add the GitHub MCP server, here's my token: ghp_…"

Confirm the config you'll register (`npx -y @modelcontextprotocol/server-github`, token
in `env`), then call `mcp__mcp-manager__install_mcp_server` without `activate`. Tell the
user it's registered and where to enable it — unless they asked you to enable it now, in
which case pass `activate: true` and say it's live.
