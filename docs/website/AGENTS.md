# Public website documentation

Read README.md here and scripts/websiteDocs/README.md before editing. Keep the website's content conventions, locale directory layout, image bytes, relative links and existing article anchors. Update both Chinese and English content when changing a shared feature; use the website's SUMMARY.md navigation format.

Only content/, locales.json, page-aliases.json and the optional shadowed-baseline.json synchronize. This README.md and AGENTS.md do not. Do not edit the isolated renderer checkout, generated pages or search indexes. Use pnpm website-docs:check and pnpm website-docs:build for verification; do not normalize imported configuration with the desktop formatter.

Do not remove mobile guides or reference pages as unrelated desktop content. Merge conflicts preserve both sides and require a maintainer resolution; do not overwrite one repository with the other's complete latest directory.
