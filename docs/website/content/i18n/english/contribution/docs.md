---
icon: book-open
---


# Contribute to Documentation

## Submit a change

1. Use **Edit on GitHub** at the bottom of the page to open the [website repository](https://github.com/CherryHQ/cherry-studio-website). Edit the source in your own branch or fork.

2. Documentation lives in `docs-site/content/`; translations live in the corresponding `i18n/` directory. Update that language’s `SUMMARY.md` when adding, moving or removing a page. Store images in `docs-site/content/assets/` and use relative links.

3. Preview and validate your changes, then open a Pull Request against `main`. Explain the problem, the pages changed and how you checked them. Documentation is maintained only in the website repository; do not request GitBook access or submit changes to the retired documentation repository.

If you cannot edit directly, [open an issue](https://github.com/CherryHQ/cherry-studio-website/issues) with the page URL and suggested correction. Hide API keys and personal information in screenshots.

## Local preview and checks

Run these commands from the website repository root. Open `/docs/en/` on the local server. Before submitting, run the validation commands below.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

```sh
pnpm docs:test
pnpm build:cn
pnpm docs:verify
```

Fix errors in `docs-site/generated/report.json` by editing `content/`. Do not edit generated files. Check links, screenshots, mobile reading and the actual product steps. For translations, compare against the current Chinese source.
