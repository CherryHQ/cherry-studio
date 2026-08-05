/**
 * System prompt section nudging the agent to declare its final deliverable file(s) via the
 * `report_artifacts` tool at task completion. The renderer reads those declarations to surface a
 * deliverables card (inline + in the collapsed right-pane info card), distinguishing real outputs
 * from intermediate/scratch files that can't be told apart in the raw tool stream.
 */
export const REPORT_ARTIFACTS_PROMPT = `## Reporting deliverables

When you finish producing the file(s) the user asked for, call the \`report_artifacts\` tool once with the final file path(s) and a one-line summary. List only the final deliverables — never intermediate, scratch, or temporary files. Skip the call entirely if the task produced no files.`
