---
name: compass-mcp-setup
description: "Configure and verify the Compass MCP server for coding clients over stdio or stateless HTTP. Use for MCP client configuration, discovery, capability negotiation, transport headers, authentication, or tool invocation setup; not for ordinary graph queries."
compatibility: "Requires the Compass CLI and an MCP-capable client."
metadata:
  version: "1"
  product: "compass"
---

# Compass MCP Setup

Use this skill to configure and verify a coding client against the native
Compass MCP server. Keep the selected transport explicit and test discovery
plus one real invocation rather than treating process startup as success.

## Workflow

1. Run `compass capabilities --format json` and verify the supported machine
   contract before generating client configuration.
2. Run `compass mcp --help` before selecting transport options.
3. For stdio, configure the client to launch the installed `compass` binary
   with the MCP subcommand and explicit graph or project selection required by
   the client workflow.
4. For HTTP, use the documented stateless MCP endpoint, protocol-version
   metadata, content negotiation, host policy, and authentication settings.
   Do not invent a legacy session or fallback transport.
5. Verify server discovery, list the advertised tools and resources, invoke one
   bounded navigation tool, read one resource when supported, and shut down the
   client cleanly.
6. Keep credentials out of committed configuration and command output. Tests
   must use local fixtures or mocks rather than real credentials or services.

## Boundaries

- Do not expose the server on an untrusted interface without explicit host and
  authentication policy.
- Do not downgrade an HTTP protocol contract to accommodate a client silently.
- Treat unknown protocol or result-envelope majors as explicit errors.
- Bound request bodies, captured output, response sizes, and subprocess time.
- Distinguish stdio process success from HTTP interoperability; verify each
  requested transport independently.
- Use `compass-navigate` for normal codebase questions after MCP is configured.

Return the client and version, transport, non-secret configuration shape,
discovery result, invocation evidence, and any unsupported matrix cell.
