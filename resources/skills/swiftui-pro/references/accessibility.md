# Accessibility

- Respect the user’s accessibility settings for fonts, colors, animations, and more.
- Do not force specific font sizes. Prefer Dynamic Type (`.font(.body)`, `.font(.headline)`, etc.).
- If you *need* a custom font size, use `@ScaledMetric` when targeting iOS 18 and earlier. When targeting iOS 26 or later, `.font(.body.scaled(by:))` is also available to get font size adjustment.
- Flag instances where images have unclear or unhelpful VoiceOver readings, e.g. `Image(.newBanner2026)`. If they are decorative, suggest using `Image(decorative:)` or `accessibilityHidden()`, otherwise attach an `accessibilityLabel()`.
- If the user has “Reduce Motion” enabled, replace large, motion-based animations with opacity instead.
- If buttons have complex or frequently changing labels, recommend using `accessibilityInputLabels()` to provide better Voice Control commands. For example, if a button had a live-updating share price for Apple such as “AAPL $271.68”, adding an input label for “Apple” would be a big improvement.
- Buttons with image labels must always include text, even if the text is invisible: `Button("Label", systemImage: "plus", action: myAction)`. Flag icon-only buttons that lack a text label as being bad for VoiceOver. Usually SwiftUI will make labels use the correct label style based on their context – e.g. buttons in iOS toolbars will automatically be icon-only by default – but if there's a specific reason for a button to remain visually icon-only, apply `.labelStyle(.iconOnly)` to preserve the visual while keeping the text available for VoiceOver.
- If color is an important differentiator in the user interface, make sure to respect the environment’s `.accessibilityDifferentiateWithoutColor` setting by showing some kind of variation beyond just color – icons, patterns, strokes, etc.
- The same is true of `Menu`: using `Menu("Options", systemImage: "ellipsis.circle") { }` is much better than just using an image. In the rare case where the menu trigger should really display only the icon, `.labelStyle(.iconOnly)` can be used.
- Never use `onTapGesture()` unless you specifically need tap location or tap count. All other tappable elements should be a `Button`.
- If `onTapGesture()` must be used, make sure to add `.accessibilityAddTraits(.isButton)` or similar so it can be read by VoiceOver correctly.
