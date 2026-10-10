# Stories Guide

This directory contains Storybook stories for `packages/ui`, separated from the source tree to keep the component implementation structure clean.

## Directory Structure

```text
stories/
├── components/
│   ├── base/           # Base component stories
│   ├── display/        # Display component stories
│   ├── interactive/    # Interactive component stories
│   ├── icons/          # Icon component stories
│   ├── layout/         # Layout component stories
│   └── composite/      # Composite component stories
└── README.md           # This guide
```

## Naming Conventions

- File names should follow `ComponentName.stories.tsx`
- Story titles should follow `Category/ComponentName`, for example `Base/CustomTag`
- Import source components through relative paths, for example `../../../src/components/base/ComponentName`

## Authoring Guidelines

Each story file should usually include:

1. **Default** - basic usage
2. **Variants** - different variants or visual states
3. **Interactive** - interaction demos when applicable
4. **Use Cases** - realistic examples

## Run Storybook

```bash
cd packages/ui
pnpm storybook
```

Open http://localhost:6006 to browse the component documentation.
