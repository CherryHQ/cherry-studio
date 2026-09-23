---
name: rust-mcp-server-generator
description: 'Generate a complete Rust Model Context Protocol server project with tools, prompts, resources, and tests using the official rmcp SDK'
---

# Rust MCP Server Generator

Use for Rust MCP server scaffolding or transport integration. Read the project's pinned rmcp version and supported protocol revisions first. For an existing server, change its production implementation directly; do not generate a replacement project.

For scaffolding or concrete server examples, load [generator reference](references/generator.md) only when needed. Treat its versions and APIs as examples, checking them against the pinned SDK.

Finish complete production functionality before testing. Use meaningful integration scenarios at completed change or phase boundaries. Unit tests, snapshots, routine Clippy runs, and repeated compiler loops in the reference are not required gates. User instructions and project pins take precedence.
