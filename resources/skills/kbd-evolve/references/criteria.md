# Evolution Criteria Profiles

Four built-in scoring profiles. Select with `--criteria <profile>`.

## effort-impact (default)

Best for: product evolution, feature prioritization, general roadmap decisions.

| Criterion | Weight | Scale | Notes |
|-----------|--------|-------|-------|
| User impact | 40% | 1-5 | How many users/workflows does this unblock? |
| Implementation effort | 25% | 1-5 inverted | 1=months, 5=trivial — inverted in scoring |
| Alignment | 20% | 1-5 | Fits project vision and existing architecture |
| Feasibility | 15% | 1-5 | Dependencies, team capability, no blockers |

**Formula:** `score = (impact × 0.40) + ((6 - effort) × 0.25) + (alignment × 0.20) + (feasibility × 0.15)`

Max score: 5.0

## strategic

Best for: quarterly planning, platform bets, capability investments.

| Criterion | Weight | Scale | Notes |
|-----------|--------|-------|-------|
| Strategic differentiation | 35% | 1-5 | Unique capability vs competitors |
| Market/ecosystem timing | 25% | 1-5 | Is this the right moment? |
| Revenue/retention leverage | 25% | 1-5 | Impact on growth or retention |
| Build vs buy decision | 15% | 1-5 | Is building the right choice? |

**Formula:** `score = (diff × 0.35) + (timing × 0.25) + (revenue × 0.25) + (build_buy × 0.15)`

## risk-adjusted

Best for: security-critical systems, compliance-heavy domains, infrastructure.

| Criterion | Weight | Scale | Notes |
|-----------|--------|-------|-------|
| Risk reduction | 35% | 1-5 | How much does this reduce known risks? |
| User impact | 25% | 1-5 | User workflow improvement |
| Reversibility | 20% | 1-5 | Can we undo this if wrong? |
| Compliance/audit value | 20% | 1-5 | External requirement coverage |

**Formula:** `score = (risk × 0.35) + (impact × 0.25) + (reversibility × 0.20) + (compliance × 0.20)`

## custom

When no built-in profile fits, define a custom profile at runtime:

```
/kbd-evolve --criteria custom
```

The skill will prompt:
1. What dimensions matter for this evolution?
2. What weight (1-100) for each?
3. What 1-5 scale means for each dimension?

Custom profiles are saved to `.kbd-orchestrator/criteria/<evolution-name>-criteria.json` for reuse.
