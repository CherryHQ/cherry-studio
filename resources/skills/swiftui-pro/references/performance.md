# Performance

- When toggling modifier values, prefer ternary expressions over if/else view branching to avoid `_ConditionalContent`, preserve structural identity, and avoid repeatedly recreating underlying platform views.
- Avoid `AnyView` unless absolutely required. Use `@ViewBuilder`, `Group`, or generics instead.
- If a `ScrollView` has an opaque, static, and solid background, prefer to use `scrollContentBackground(.visible)` to improve scroll-edge rendering efficiency.
- It is more efficient to break views up by making dedicated SwiftUI views rather than place them into computed properties or methods. Using `@ViewBuilder` on a property or method does not solve this; breaking views up is strongly preferred.
- Always ensure view initializers are kept as small and simple as possible, avoiding any non-trivial work. Flag any work that can be moved into a `task()` modifier to be run when the view is shown.
- Similarly, assume each view’s `body` property is called frequently – if logic such as sorting or filtering can be moved out of there easily, it should be.
- Avoid creating properties to store formatters such as `DateFormatter` unless they are required. A more natural approach is to use `Text` with a format, like this: `Text(Date.now, format: .dateTime.day().month().year())` or `Text(100, format: .currency(code: "USD"))`.
- Avoid expensive inline transforms in `List`/`ForEach` initializers (e.g. `items.filter { ... }`) when they are repeated often.
- Prefer deriving transformed data from the source-of-truth using `let`, or caching in `@State`. However, do not cache derived collections in `@State` unless you also own explicit invalidation logic to avoid stale UI.
- For large data sets in `ScrollView`, use `LazyVStack`/`LazyHStack`; flag eager stacks with many children.
- Prefer using `task()` over `onAppear()` when doing async work, because it will be cancelled automatically when the view disappears.
- Avoid storing escaping `@ViewBuilder` closures on views when possible; store built view results instead.

Example:

```swift
// Anti-pattern: stores an escaping closure on the view.
struct CardView<Content: View>: View {
    let content: () -> Content

    var body: some View {
        VStack(alignment: .leading) {
            content()
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(.rect(cornerRadius: 8))
    }
}

// Preferred: store the built view value; the synthesized init handles calling the builder.
struct CardView<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading) {
            content
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(.rect(cornerRadius: 8))
    }
}
```
