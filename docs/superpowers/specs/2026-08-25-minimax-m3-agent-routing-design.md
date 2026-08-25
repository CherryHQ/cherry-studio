# MiniMax M3 Agent Routing Fix

## Context

[Issue #19271](https://github.com/CherryHQ/cherry-studio/issues/19271) reports that a scheduled Agent task using `minimax::MiniMax-M3` fails with `reasoning part reasoning-0 not found`, followed by a generic Claude Code internal error.

The Claude Agent SDK speaks Anthropic Messages natively. Cherry Studio already routes a model directly to a provider's Anthropic endpoint when both of these conditions hold:

- the resolved model declares `anthropic-messages` in `endpointTypes`;
- the provider configures an Anthropic Messages base URL.

Both official MiniMax presets configure Anthropic base URLs, but `MiniMax-M3` has no provider-model endpoint override. It therefore inherits the providers' OpenAI Chat default and is sent through the local API Gateway, adding an avoidable reasoning-block translation boundary.

## Selected Design

Add a source-controlled `MiniMax-M3` override shared by the `minimax` and `minimax-global` provider definitions:

```text
endpointTypes = [openai-chat-completions, anthropic-messages]
```

The order is intentional:

- regular Cherry Studio chat continues to prefer OpenAI Chat Completions;
- Claude Agent sessions request Anthropic Messages and can route directly to the official MiniMax Anthropic endpoint;
- both MiniMax regions keep identical model capabilities.

The provider definition remains the sole owner of this routing fact. Generated `packages/provider-registry/data/*.json` files will be updated only through the package generator.

## Alternatives Considered

1. Change the AI SDK stream assembler or reasoning extraction middleware. This could mask malformed reasoning event sequences across every provider without evidence that the shared assembler is defective. It is too broad for a provider-specific missing capability declaration.
2. Special-case MiniMax inside the Agent runtime. This would duplicate endpoint knowledge outside the provider registry and make future model additions dependent on runtime conditionals.
3. Retry failed scheduled Agent jobs. Whole-task retries can repeat model charges, messages, and tool side effects. Retry policy is a separate product decision and does not remove the protocol mismatch.

## Scope

In scope:

- official `minimax` and `minimax-global` provider model endpoint declarations;
- generated provider-model catalog artifacts;
- regression coverage for endpoint ordering and regional parity.

Out of scope:

- shared streaming or reasoning middleware changes;
- API Gateway error-shape changes;
- scheduled job retry behavior;
- schemas, migrations, Preference, Cache, DataApi, or other persistent-state contracts.

## Test-Driven Verification

1. Add endpoint-matrix assertions for both official MiniMax providers and run them first to demonstrate the missing override.
2. Add the shared provider override and regenerate the catalog.
3. Run the provider-registry test suite, including catalog invariants and source-sync checks.
4. Run the focused Agent routing test that proves a model with OpenAI Chat first and Anthropic Messages available is routed directly for Claude Agent sessions.
5. Run `pnpm lint`; broader application tests are unnecessary because the runtime routing code and shared contracts are unchanged.

## Expected Outcome

`MiniMax-M3` continues using OpenAI Chat Completions in ordinary chat, while Claude Agent sessions bypass the local gateway and use the official Anthropic Messages endpoint, preserving native reasoning-block semantics.
