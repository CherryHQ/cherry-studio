# Serve the graph over MCP

Load this reference when an editor or agent needs live Model Context Protocol
access to a graph.

Standard input/output is the local default:

```bash
compass serve compass-out/graph.json
```

HTTP serving is network-visible according to its bind address:

```bash
compass serve \
  --transport http \
  --host 127.0.0.1 \
  --port 8080 \
  --api-key "$COMPASS_MCP_TOKEN"
```

Run `compass serve --help` for the graph selector, path, JSON response mode,
stateful/stateless behavior, and session timeout. Prefer loopback unless the user
explicitly needs remote clients. Require an API key for non-loopback exposure.

Serving is long-lived. Report the chosen graph and endpoint, keep secrets out of
logs, and stop the process when requested. Starting a server does not refresh
the graph; update or extract first when freshness matters.

## Agent Graph tools

For an AI coding session that needs GROUNDED overlay reads, explicitly allow one
canonical project:

```bash
compass serve compass-out/graph.json \
  --agent-graph-project .
```

This advertises the read-only `inspect_agent_graph` tool. Add
`--agent-graph-writes` only when the user wants the connected agent to apply
versioned change batches. Add `--agent-graph-masks` only for separately approved
curated masking. Outside Git, also choose an explicit
`--agent-graph-state-root`.

Before drafting a batch, call `inspect_agent_graph` with operation `prepare`,
the relevant `base_nodes` or `base_edges`, and one or more `source_spans`
objects containing `file`, `startByte`, and `endByte`. Compass returns the exact
Base references, evidence digests, and current expected revision; do not
calculate them in the client.

HTTP write access requires a distinct `--write-api-key` in addition to the read
API key. Never accept the principal, allowed project, permissions, expiry, or
limits from a model request; configure those on the Compass server. Clients
must preserve the exact Base Generation and Overlay Revision returned in MCP
receipts and reads. Load `references/agent-graph.md` for the session workflow.
