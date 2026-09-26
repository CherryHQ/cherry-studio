# Reading a site without a browser

Fetch the HTML, then the stylesheets it links, then grep. That answers most questions a scriptable browser answers and a few it cannot.

Do not use a markdown-converting fetch for this. It strips exactly what you came for. Fetch the raw bytes.

> Inspect the indicated project files using the harness file tools or Node.js filesystem APIs. This upstream shell example is omitted in the portable distribution.

Pull each stylesheet the same way, resolving protocol-relative and root-relative hrefs against the page's origin first.

## Utility CSS is self-describing

Where the site uses utility classes, the markup already contains the declarations and no stylesheet lookup is needed. Grep the class attribute for the effect:

> Inspect the indicated project files using the harness file tools or Node.js filesystem APIs. This upstream shell example is omitted in the portable distribution.

This is where the fetch method beats a browser. A class list carries every responsive and state variant at once, so `blur-[50px] md:h-214 md:-translate-x-1/2` says the element changes shape at the `md` breakpoint. Computed styles read at one width cannot.

Semantic CSS gives you a hashed class name instead (`Hero_glow__a1b2c`). Take that name to the stylesheet and search for it there with the harness file tools.

## Inline styles carry the values utilities cannot express

A multi-stop gradient is usually too specific for a utility, so it lands in a `style` attribute:

> Inspect the indicated project files using the harness file tools or Node.js filesystem APIs. This upstream shell example is omitted in the portable distribution.

## The stylesheet, for tokens and generated utilities

> Inspect the indicated project files using the harness file tools or Node.js filesystem APIs. This upstream shell example is omitted in the portable distribution.

To understand a custom utility, search for its class name with the harness file tools in the stylesheet and read the declaration whole. That is how `gradient-ease-in-out` turns into its mechanism, a generated stop list built with `color-mix()` and relative color syntax rather than twelve hand-written stops.

## Stack fingerprints from the HTML alone

> Inspect the indicated project files using the harness file tools or Node.js filesystem APIs. This upstream shell example is omitted in the portable distribution.

Report these as fingerprints with the evidence that produced them, never as facts. `/_next/static` in an asset path is strong; a utility-looking class name alone is weak.

## What this method cannot tell you

Say so rather than guessing past it:

- **Which rule won.** Nine rules may match one element; only a browser resolves the cascade.
- **Anything injected at runtime.** CSS-in-JS, a theme applied by script, styles added on interaction.
- **Paint order and what is actually visible.** A declaration in the CSS may be overridden or never rendered.
- **Live animation state.** Whether an effect moves at all.
- **Computed values.** A `rem` stays a `rem`, and you never learn the resolved pixel size.
