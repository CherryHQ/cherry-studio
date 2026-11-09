# Agent Note: Script the model decision in Everything MCP regression

Status: implemented

English | [中文](2026-11-07-everything-mcp-model-boundary.zh.md)

## Problem

MCP-01 combined server creation, real tool execution, persistence and restart with an external model's decision to call a specific tool. Model latency and output formatting made a product integration check nondeterministic.

## Decision

Use the shared loopback chat server to request the real Everything `get-sum` tool offered by the application. The fixture declares function-call support and a 128k context window so this case exercises direct tool dispatch. It returns final text only after receiving the actual numeric tool result. The test retains UI binding, persisted input/output assertions and reconnect-after-restart checks.

## Alternatives considered

- Longer timeouts and automatic retries increase cost without controlling the model decision.
- Faking an MCP result would bypass the integration that this case must protect.

## Consequences

The model boundary is controlled; the Everything process, tool execution and application state remain real. This case does not evaluate external model quality or deferred-tool discovery. Provider-backed chat and tool-registry tests own those separate contracts. The temporary model, assistant and topics are removed in teardown.

## Verification

- Regression — 28 shared HTTP-server tests passed, including executable function-call responses through both installed OpenAI adapters in streaming and non-streaming modes.
- Regression — three consecutive local MCP-01 runs passed in 44.3, 37.7 and 39.6 seconds; each executed the real tool and restarted the application. The focused controller gate passed and owned runtime cleanup succeeded. Hosted cross-platform acceptance remains separate.
