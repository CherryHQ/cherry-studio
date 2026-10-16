# Cherry Studio End-to-End Regression Report

> **Overall verdict: ❌ Development tests failed**

## Run information

| Item | Value |
| --- | --- |
| Platform | macOS |
| GitHub runner | `local` |
| Test reference | `pr-21798` |
| Commit SHA | `222ca60aba14fdc36fdaf011d2987bd692ee4142` |
| App version | `development-222ca60` |
| Run mode | Development branch |
| Task selection | Create and use Everything MCP |
| Started at (UTC) | `2026-10-16T12:56:34.329Z` |
| Finished at (UTC) | `2026-10-16T12:58:57.431Z` |
| Duration | 2m 23s |

## Results overview

| Applicable cases | Passed | Failed | Blocked | Incomplete |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 1 | 0 | 0 |

## Phase execution

| Phase | Status | Executor errors |
| --- | --- | --- |
| 07-integrations | ❌ Failed | Test executor exited abnormally (exit code 1) |

## Case details

| ID | Test case | Result | Summary | Artifacts |
| --- | --- | --- | --- | ---: |
| MCP-01 | Create and use Everything MCP | ❌ Failed | End-to-end test failed; see phase logs and the HTML report | 1 |

## Failures and blockers

### ❌ Failed · MCP-01 · Create and use Everything MCP

- **Summary:** End-to-end test failed; see phase logs and the HTML report
- **Artifacts:** 1

<details>
<summary>Capability checks (2 / 7 available)</summary>

| Capability | Result | Details |
| --- | --- | --- |
| Desktop automation | ❌ Unavailable | macOS System Events accessibility automation is disabled |
| Cross-app text selection | ❌ Unavailable | Cross-app text selection requires desktop automation: macOS System Events accessibility automation is disabled |
| Global shortcut | ❌ Unavailable | macOS System Events accessibility automation is disabled |
| Direct CDP connection | ✅ Available | Direct CDP connection available |
| npx | ✅ Available | 11.9.0 |
| Screen capture | ❌ Unavailable | Screen capture unavailable: Command failed: screencapture -x /Volumes/cherrydev/development/cherry-studio/qa/pr-testing/runs/regression-21798-everything-mcp-222ca60/run.205634/evidence/capability-screen.png |
| System file picker | ❌ Unavailable | macOS System Events accessibility automation is disabled |

</details>
