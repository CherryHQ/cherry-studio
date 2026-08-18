# Outputs: images and artifacts

Covers `mcp__cherry-tools__generate_image` and `mcp__cherry-tools__report_artifacts`.

Get exact argument shapes from the live tool schema — this reference gives routing,
prerequisites, and semantics only.

## Image generation — `mcp__cherry-tools__generate_image`

Renders an image from a prompt using the configured **painting model**.

- **Always listed, but requires a configured painting model.** With none configured it
  returns an explanatory note instead of an image — **relay that note** and point the
  user to configure a painting model. Do not claim an image was produced.
- **Tool error result** → read the message and correct the call; don't silently retry.

## Artifacts — `mcp__cherry-tools__report_artifacts`

Declares your final deliverable file(s) so Cherry can surface them to the user.

1. **Produce the file first** with your normal tools.
2. Then call `mcp__cherry-tools__report_artifacts` to register it as a deliverable.

**It's a declaration, not a transfer.** `report_artifacts` makes Cherry aware of the
deliverable in the UI; it does **not** push the file anywhere. To actually send a file to
the user through an IM channel, use `mcp__cherry-tools__notify` instead (see
[autonomy.md](autonomy.md)). Pick by intent:

- Surface a finished file in the Cherry UI → `report_artifacts`.
- Deliver a file to the user over a connected channel → `notify`.

They're not interchangeable, and you may legitimately do both for the same file.
