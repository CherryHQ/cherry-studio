# Landscape Research Protocol

Guidelines for the research stage of `/kbd-evolve`. Scales with `--depth`.

## Domain taxonomy (first step)

Before searching, classify the project into 1-3 primary domains:

| Example domains | Keywords to derive |
|----------------|-------------------|
| Realtime infrastructure | event streaming, pub/sub, WebSocket, CRDT, local-first |
| Skill/agent orchestration | LLM agents, tool use, multi-agent, workflow, AI assistants |
| Entity management | state management, normalized store, graph, CRUD |
| Developer tooling | CLI, code generation, linting, scaffolding |
| Build systems | compilation, incremental builds, caching, CI/CD |

Derive from CLAUDE.md, README.md, package.json description, or the current KBD phase history.

## Search strategy by depth

### quick (2-3 sources, ~5 min)

1. GitHub starred repos search for top 3 keywords
2. `firecrawl_search` or `tavily_search` for "best <domain> tools 2025"
3. One targeted doc lookup (e.g., awesome list for the domain)

### standard (5-8 sources, ~15 min)

All quick steps plus:
4. GitHub recent releases in top 5 repos for the domain
5. Hacker News "Ask HN: what are you using for X" threads
6. One academic or RFC source (e.g., IETF RFC, design doc)
7. Key blog posts from major players (last 6 months)

### deep (10+ sources, ~30 min)

All standard steps plus:
8. Multiple GitHub searches across 3+ keyword variants
9. Comparative benchmarks or community surveys
10. Issue tracker sentiment in major repos (what are users asking for?)
11. Changelog analysis of 2-3 leading projects
12. Academic papers if domain is research-adjacent

## Source weighting

| Source type | Weight | Rationale |
|-------------|--------|-----------|
| Official docs / changelogs | High | Authoritative, up to date |
| GitHub stars + recent activity | High | Community validation |
| Hacker News / Reddit discussion | Medium | User sentiment, real use cases |
| Blog posts from maintainers | Medium | Strategic direction signal |
| SEO-heavy blog posts | Low | Often shallow; cross-reference |
| Benchmarks | Medium-High | Verify methodology before trusting |

## What to record

For each source, capture:
- Tool/project name and version
- Key capabilities relevant to the project's domain
- Notable strengths
- Gaps or weaknesses
- Community momentum signal (stars, recent commits, issue velocity)

Output is the **landscape summary** fed into the gap analysis stage.

## Anti-patterns to avoid

- Do NOT only search for the project's own keywords — search for the domain's vocabulary.
- Do NOT cite sources without reading them (even briefly).
- Do NOT assume the current project's approach is standard; verify against peers.
- Do NOT stop at 1-2 sources even in `quick` mode if they conflict.
