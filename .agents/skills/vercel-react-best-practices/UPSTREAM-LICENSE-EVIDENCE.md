# Agent Skills

A collection of skills for AI coding agents. Skills are packaged instructions and scripts that extend agent capabilities.

Skills follow the [Agent Skills](https://agentskills.io/) format.

[![skills.sh](https://skills.sh/b/vercel-labs/agent-skills)](https://skills.sh/vercel-labs/agent-skills)

## Available Skills

### vercel-optimize

Audits a Vercel project for cost, performance, reliability, caching, function usage, and billing opportunities. It collects Vercel metrics first, then investigates only the routes and files those metrics point to.

**Use when:**

- Optimizing a deployed Vercel project
- Reducing Vercel costs or function usage
- Investigating slow or expensive routes
- Finding caching, ISR, middleware, image, or build-minute issues
- Producing a ranked cost and performance report

### react-best-practices

React and Next.js performance optimization guidelines from Vercel Engineering. Contains 40+ rules across 8 categories, prioritized by impact.

**Use when:**

- Writing new React components or Next.js pages
- Implementing data fetching (client or server-side)
- Reviewing code for performance issues
- Optimizing bundle size or load times

**Categories covered:**

- Eliminating waterfalls (Critical)
- Bundle size optimization (Critical)
- Server-side performance (High)
- Client-side data fetching (Medium-High)
- Re-render optimization (Medium)
- Rendering performance (Medium)
- JavaScript micro-optimizations (Low-Medium)

### web-design-guidelines

Review UI code for compliance with web interface best practices. Audits your code for 100+ rules covering accessibility, performance, and UX.

**Use when:**

- "Review my UI"
- "Check accessibility"
- "Audit design"
- "Review UX"
- "Check my site against best practices"

**Categories covered:**

- Accessibility (aria-labels, semantic HTML, keyboard handlers)
- Focus States (visible focus, focus-visible patterns)
- Forms (autocomplete, validation, error handling)
- Animation (prefers-reduced-motion, compositor-friendly transforms)
- Typography (curly quotes, ellipsis, tabular-nums)
- Images (dimensions, lazy loading, alt text)
- Performance (virtualization, layout thrashing, preconnect)
- Navigation & State (URL reflects state, deep-linking)
- Dark Mode & Theming (color-scheme, theme-color meta)
- Touch & Interaction (touch-action, tap-highlight)
- Locale & i18n (Intl.DateTimeFormat, Intl.NumberFormat)

### writing-guidelines

Review docs and prose for compliance with the Vercel writing handbook. Audits your pages for 80+ rules covering voice, structure, content types, code samples, typography, and AI workflow.

**Use when:**

- "Review my docs"
- "Check writing style"
- "Audit prose"
- "Review docs voice and tone"
- "Check this page against the writing handbook"

**Categories covered:**

- Planning (content plan, content type, user-shaped titles)
- Voice & tone (active voice, direct address, banned words like `easy`/`simple`/`quick`)
- Tone by content type (tutorial, how-to, reference, conceptual, troubleshooting)
- Headings & structure (sentence case, descriptive subheadings, TL;DR opens)
- Lists (when to use, bold/description format)
- Code (language tags, TypeScript first, `<Steps/>`, 80-col / 25-line limits)
- Placeholders, units, & numbers (`snake_case` text, count-up numbers, `64 KB`/`200 ms`)
- Typography (no em dashes as punctuation, curly quotes, ellipsis character, non-breaking spaces)
- Source formatting (no hard-wrap, no `---` rules, blank line discipline)
- Pricing & money pages (tables, uncompromising detail)
- AI workflow (accountability, enterprise models, plan first, disclose AI use)
- Review (PR description discipline, author accountability)

### react-native-guidelines

React Native best practices optimized for AI agents. Contains 16 rules across 7 sections covering performance, architecture, and platform-specific patterns.

**Use when:**

- Building React Native or Expo apps
- Optimizing mobile performance
- Implementing animations or gestures
- Working with native modules or platform APIs

**Categories covered:**

- Performance (Critical) - FlashList, memoization, heavy computation
- Layout (High) - flex patterns, safe areas, keyboard handling
- Animation (High) - Reanimated, gesture handling
- Images (Medium) - expo-image, caching, lazy loading
- State Management (Medium) - Zustand patterns, React Compiler
- Architecture (Medium) - monorepo structure, imports
- Platform (Medium) - iOS/Android specific patterns

### react-view-transitions

Implement smooth, native-feeling animations using React's View Transition API. Covers the `<ViewTransition>` component, `addTransitionType`, transition types, and Next.js integration including the `transitionTypes` prop on `next/link`.

**Use when:**

- Adding page transitions or route animations
- Animating enter/exit of components
- Creating shared element transitions (list-to-detail morphing)
- Implementing directional (forward/back) navigation animations
- Integrating view transitions in Next.js App Router
- Animating list reorder or Suspense fallback reveals

**Topics covered:**

- `<ViewTransition>` component (enter, exit, update, share triggers)
- `addTransitionType` for directional/context-specific animations
- View Transition Classes and CSS pseudo-elements
- Shared element transitions with the `name` prop
- JavaScript animations via Web Animations API
- Next.js `transitionTypes` prop on `next/link`
- Ready-to-use CSS animation recipes (fade, slide, scale, flip)
- Accessibility (`prefers-reduced-motion`)

### composition-patterns

React composition patterns that scale. Helps avoid boolean prop proliferation through compound components, state lifting, and internal composition.

**Use when:**

- Refactoring components with many boolean props
- Building reusable component libraries
- Designing flexible APIs
- Reviewing component architecture

**Patterns covered:**

- Extracting compound components
- Lifting state to reduce props
- Composing internals for flexibility
- Avoiding prop drilling

### vercel-deploy-claimable

Deploy applications and websites to Vercel instantly. Designed for use with claude.ai and Claude Desktop to enable deployments directly from conversations. Deployments are "claimable" - users can transfer ownership to their own Vercel account.

**Use when:**

- "Deploy my app"
- "Deploy this to production"
- "Push this live"
- "Deploy and give me the link"

**Features:**

- Auto-detects 40+ frameworks from `package.json`
- Returns preview URL (live site) and claim URL (transfer ownership)
- Handles static HTML projects automatically
- Excludes `node_modules` and `.git` from uploads

**How it works:**

1. Packages your project into a tarball
2. Detects framework (Next.js, Vite, Astro, etc.)
3. Uploads to deployment service
4. Returns preview URL and claim URL

**Output:**

```
Deployment successful!

Preview URL: https://skill-deploy-abc123.vercel.app
Claim URL:   https://vercel.com/claim-deployment?code=...
```

## Installation

```bash
npx skills add vercel-labs/agent-skills
```

## Usage

Skills are automatically available once installed. The agent will use them when relevant tasks are detected.

**Examples:**

```
Deploy my app
```

```
Review this React component for performance issues
```

```
Help me optimize this Next.js page
```

## Discovery index

Every change to a skill on `main` publishes an immutable GitHub release with
an Agent Skills discovery index and one artifact per skill. Build the same
artifacts locally with:

```bash
npm ci --ignore-scripts
node scripts/build-discovery-index.mjs https://example.com/skills
```

## Skill Structure

Each skill contains:

- `SKILL.md` - Instructions for the agent
- `scripts/` - Helper scripts for automation (optional)
- `references/` - Supporting documentation (optional)

## License

MIT
