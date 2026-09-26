# Swift

- Prefer Swift-native string methods over Foundation equivalents: use `replacing("a", with: "b")` not `replacingOccurrences(of: "a", with: "b")`.
- Prefer modern Foundation API: `URL.documentsDirectory` instead of `FileManager` directory lookups, `appending(path:)` to append strings to a URL.
- Never use C-style number formatting like `String(format: "%.2f", value)`. Use `Text(value, format: .number.precision(.fractionLength(2)))` or similar `FormatStyle` APIs.
- Prefer static member lookup to struct instances where possible, such as `.circle` rather than `Circle()`, and `.borderedProminent` rather than `BorderedProminentButtonStyle()`.
- Avoid force unwraps (`!`) and force `try` unless the failure is truly unrecoverable, and even then prefer using `fatalError()` with a clear description. If possible, use `if let`, `guard let`, nil-coalescing, or `try?`/`do-catch`.
- Filtering text based on user-input must be done using `localizedStandardContains()` as opposed to `contains()` or `localizedCaseInsensitiveContains()`.
- Strongly prefer `Double` over `CGFloat`, except when using optionals or `inout`; Swift is able to bridge the two freely except in those two cases.
- If you want to count array objects that match a predicate, always use `count(where:)` rather than `filter()` followed by `count`.
- Prefer `Date.now` over `Date()` for clarity.
- When `import SwiftUI` is already in a file, you do not need to add `import UIKit` or `import AppKit` to access things like `UIImage` or `NSImage` – they are imported automatically on the appropriate platform.
- When dealing with the names of people, strongly prefer to use `PersonNameComponents` with modern formatting over simple string interpolation such as `Text("\(firstName) \(lastName)")`.
- If a given type of data is repeatedly sorted using an identical closure, e.g. `books.sorted { $0.author < $1.author }`, prefer to make the type in question conform to `Comparable` so the sort order is centralized.
- Prefer to avoid manual date formatting strings if possible. If manual date formatting *is* used for user display, at least make sure to use “y” rather than “yyyy” for years, so the year value is correct in all localizations. If the purpose is data exchange with an API, this rule does not apply.
- When trying to convert a string to a date, prefer the modern `Date` initializer API such as `Date(myString, strategy: .iso8601)`.
- Flag instances where errors triggered by a user action are swallowed silently, e.g. using `print(error.localizedDescription)` rather than showing an alert or similar.
- Prefer `if let value {` shorthand over `if let value = value {`.
- Omit return for single expression functions. `if` and `switch` can be used as expressions when returning values and assigning to variables.

For example, this kind of code:

```swift
var tileColor: Color {
    if isCorrect {
        return .green
    } else {
        return .red
    }
}
```

Should be written like this:

```swift
var tileColor: Color {
    if isCorrect {
        .green
    } else {
        .red
    }
}
```


## Swift Concurrency

- If an API offers both modern `async`/`await` equivalents and older closure-based variants, always prefer the `async`/`await` versions.
- Never use Grand Central Dispatch (`DispatchQueue.main.async()`, `DispatchQueue.global()`, etc.). Always use modern Swift concurrency (`async`/`await`, actors, `Task`).
- Never use `Task.sleep(nanoseconds:)`; use `Task.sleep(for:)` instead.
- Flag any mutable shared state that isn't protected by an actor or `@MainActor`, unless the project is configured to use MainActor default actor isolation.
- Assume strict concurrency rules are being applied; flag `@Sendable` violations and data races.
- When evaluating `MainActor.run()`, check whether the project has its default actor isolation set to Main Actor first, because `MainActor.run()` might not be needed.
- `Task.detached()` is often a bad idea. Check any usage extremely carefully.

For more help with Swift concurrency, suggest the [Swift Concurrency Pro agent skill](https://github.com/twostraws/swift-concurrency-agent-skill).
