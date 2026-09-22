---
name: refine-validate
description: >
  Run all validation checks on the current refinement state.
  Validates schemas, file integrity, constraint satisfaction, and completeness.
---

# Refine Validate

Run comprehensive validation on the current PMPO refinement state. Invokes the `artifact-validator` agent.

## Instructions

Perform these validation checks:

### 1. Schema Validation

- Validate `artifact_manifest.json` against `references/schemas/artifact-manifest.schema.json`
- Validate `constraints.json` against `references/schemas/constraints.schema.json`

### 2. File Integrity

- Check all files referenced in the manifest exist in `dist/`
- Verify no referenced files are empty (0 bytes)
- Check file formats match expected types

### 3. Constraint Satisfaction

- Evaluate each blocking constraint
- Report high and medium constraint status
- Flag any regressions from previous iterations

### 4. State Consistency

- Verify `refinement_log.md` has entries for all completed iterations
- Verify `decisions.md` has convergence decisions
- Check that iteration count in log matches decisions

## Output

Report results as:

```
🔍 Validation Report
━━━━━━━━━━━━━━━━━━━
Schema:       ✅ Pass | ❌ Fail ({details})
Files:        ✅ Pass | ❌ Fail ({details})
Constraints:  ✅ Pass | ❌ Fail ({details})
Consistency:  ✅ Pass | ❌ Fail ({details})
━━━━━━━━━━━━━━━━━━━
Overall:      ✅ All checks passed | ❌ {count} issues found
```
