# Chapter 8 - Comments vs Documentation

> Clear code beats clear comments. However, when the why isn't obvious, comment it plainly - or link to where you can read more context.

## 8.1 Comments vs Documentation: Know the Difference

| Purpose | Use `// comment` | Use `/// doc` or `//! crate doc` |
|-------------- |------------------------------------------- |---------------------------------------------------------------- |
| Describe Why | ✅ Yes - explains tricky reasoning | ❌ Not for documentation |
| Describe API | ❌ Not useful | ✅ Yes - public interfaces, usage, details, errors, panics |
| Maintainable | 🚨 Often becomes obsolete and hard to reason | ✅ Tied to code, appears in generated docs and can run test cases |
| Visibility | Local development only | Exported to users and tools like `cargo doc` |

## 8.2 When to use comments

Use `//` comments (double slashed) when something can't be expressed clearly in code, like:
* **Safety Guarantees**, some of which can be better expressed with code conditionals.
* Workarounds or **Optimizations**.
* Legacy or **platform-specific** behaviors. Some of them can be expressed with `#[cfg(..)]`.
* Links to **Design Docs** or **ADRs**.
* Assumptions or **gotchas** that aren't obvious.

> Name your comments! For example, a comment regarding a safety guarantee should start with `// SAFETY: ...`.

### ✅ Good comment:
```rust
// SAFETY: `ptr` is guaranteed to be non-null and aligned by caller
unsafe { std::ptr::copy_nonoverlapping(src, dst, len); }
```

### ✅ Design context comment:
```rust
// CONTEXT: Reuse root cert store across subgraphs to avoid duplicate OS calls:
// [ADR-12](link/to/adr-12): TLS Performance on MacOS
```

## 8.3 When comments get in the way

Avoid comments that:
* Restate obvious things (`// increment i by 1 for the next loop`).
* Can grow stale over time.
* `TODO`s without actions (links to some versioned issue).
* Could be replaced by better naming or smaller functions.

### ❌ Bad comment:
```rust
fn compute(counter: &mut usize) {
    // increment by 1
    *counter += 1;
}
```

### ❌ Too long or outdated
```rust
// Originally written in 2028 for some now-defunct platform
```

## 8.4 Don't Write Living Documentation (living comments)

Comments as a "living documentation" is a **dangerous myth**, as comments are **not free**:
* They **rot** - nobody compiles comments.
* They **mislead** - readers usually assume they are true with no critique, e.g. "the other developer knows this code better than I do".
* They **go stale** - unless maintained with the code, they become irrelevant.
* They are **noisy** - comments can clutter your code with multiple unnecessary lines.

If something deserves to live beyond a PR, put it in:
* An **ADR** (Architectural Design Record).
* A Design Document.
* Document it **in code** by using types, doc comments, examples, renaming code blocks into cleaner functions.
* Add tests to cover and explain the change.

> ### 🚨 If you find a comment, **read it in context**. Does it still make sense? If not, remove or update it, or ask for help. Comments should bother you.

## 8.5 Replace Comments with Code

Instead of long commented blocks, break logic into named helper functions:

#### ❌ Commented code block:
```rust
fn save_user(&self) -> Result<(), MyError> {
    // check if the user is authenticated
    if self.is_authenticated() {
        // serialize user data
        let data = serde_json::to_string(self)?;
        // write to file
        std::fs::write(self.path(), data)?;
    }
}
```
**✅ Extract for clarity**:

```rust
fn save_auth_user(&self) -> Result<PathBuf, MyError> {
    if self.is_authenticated() {
        let path = self.path();
        let serialized_user = serde_json::to_string(self)?;
        std::fs::write(path, serialized_user)?;
        Ok(path)
    } else {
        Err(MyError::UserNotAuthenticated)
    }
}
```

> ❗ Extract when the **name adds meaning** -- not to deduplicate a couple of similar-looking lines. See [Chapter 1, §1.8](./chapter_01.md#18-when-to-extract-a-function-and-when-not-to) for when duplication is the better trade-off.

## 8.6 `TODO` should become issues

Don't leave `// TODO:` scattered around the codebase with no owner. Instead:
1. File Github Issue or Jira Ticket. (Prefer github issues on public repositories).
2. Reference the issue in the code:

```rust
// TODO(issue #42): Remove workaround after bugfix
```

This makes `TODO`s trackable, actionable and visible to everyone.

## 8.7 When to use doc comments

Use `///` doc comments to document:
* All **public functions, structs, traits, enums**.
* Their purpose, their usage and their behaviors.
* Anything developers need to understand how to use it correctly.
* Add context that related to `Errors` and `Panics`.
* Plenty of examples.

### ✅ Good doc comment:

```rust
/// Loads [`User`] profile from disk
/// 
/// # Error
/// - Returns [`MyError`] if the file is missing [`MyError::FileNotFound`].
/// - Returns [`MyError`] if the content is an invalid Json, [`MyError::InvalidJson`].
fn load_user(path: &Path) -> Result<User, MyError> {...}
```

**Doc comments can also include examples, links and even tests:**

```rust
/// Returns the square of the integer part of any number.
/// Square is limited to `u128`.
/// 
/// # Examples
/// 
/// ```rust
/// assert_eq!(square(4.3), 16)
/// ```
fn square(x: impl ToInt) -> u128 { ... }
```

## 8.8 Documentation in Rust: How, When and Why

Rust provides **first-class documentation tooling** via rustdoc, which makes documenting your code a key part of writing idiomatic and maintainable rust. There are doc specific lints to help with documentation, like:

| Lint | Description |
|-------------- |------------------------------------------- |
| [missing_docs](https://doc.rust-lang.org/rustdoc/lints.html#missing_docs) | Warns that a public functions, struct, const, enum has missing documentation |
| [broken_intra_doc_links](https://doc.rust-lang.org/rustdoc/lints.html#broken_intra_doc_links) | Detects if an internal documentation link is broken. Specially useful when things are renamed. |
| [empty_docs](https://rust-lang.github.io/rust-clippy/master/#empty_docs) | Disallow empty docs - preventing bypass of `missing_docs` |
| [missing_panics_doc](https://rust-lang.github.io/rust-clippy/master/#missing_panics_doc) | Warns that documentation should have a `# Panics` section if function can panic |
| [missing_errors_doc](https://rust-lang.github.io/rust-clippy/master/#missing_errors_doc) | Warns that documentation should have a `# Errors` section if function returns a `Result` explaining `Err` conditions |
| [missing_safety_doc](https://rust-lang.github.io/rust-clippy/master/#missing_safety_doc) | Warns that documentation should have a `# Safety` section if public facing functions have visible unsafe blocks |


### Difference between `///` and `//!`

| Style | Used for | Scope |Example |
|---------- |------------------------------ |------------------------------------------- |---------------------------------------------------------------- |
| `///` | Line doc comment | Public items like struct, fn, enum, consts | Documenting, giving context and usage to `fn`, `struct`, `enum`, etc |
| `//!` | Module level doc comment | Modules or entire crates | Explaining crate/module purpose with common use cases and quickstart |

### `///` Item level documentation

Use `///` for functions, structs, traits, enums, const, etc:

```rust
/// Adds two numbers together.
///
/// # Examples
///
/// ```
/// let result = my_crate::add(2, 3);
/// assert_eq!(result, 5);
/// ```
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
```
* ✅ Write clear and descriptive **What it does** and **how to use it**.
* ✅ Use `# Examples` section to better explain **how to use it**.
* ✅ Prefer writing examples that can be tested via `cargo test`, even if you have to hide their output with starting `#`:
```rust
/// ```
/// let result = my_crate::add(2, 3);
/// # assert_eq!(result, 5);
/// ```
```
* ✅ Use `# Panics`, `# Errors` and `# Safety` sections when relevant.
* Add relevant context to the type.

### `//!` Module/Crate level Documentation

Use `//!` when you want to document the **purpose of a module or a crate**. It is places at the top of a `lib.rs` or `mod.rs` file, for example `engine/mod.rs`:
```rust
//! This module implements a custom chess engine.
//! 
//! It handles board state, move generation and check detection.
//! 
//! # Example
//! ```
//! let board = chess::engine::Board::default();
//! assert!(board.is_valid());
//! ```
```

## 8.9 Checklist for Documentation coverage

📦 Crate-Level (lib.rs)
- [ ] `//!` doc at top explains **what the crate does**, and **what problems it solves**.
- [ ] Includes crate-level `# Examples` or pointers to modules.

📁 Modules (mod.rs or inline)
- [ ] `//!` doc explains **what this module is for**, its **exports**, and **invariants**.
- [ ] Avoid repeating doc comments on re-exported items unless clarification is needed.

🧱 Structs, Enums, Traits
- `///` doc explains:
    - [ ] The role this type plays.
    - [ ] Invariants or expectations.
    - [ ] Example construction or usage.
- [ ] Consider using [`#[non_exhaustive]`](https://doc.rust-lang.org/reference/attributes/type_system.html#the-non_exhaustive-attribute) if external users may match on it.

🔧 Functions and Methods
- `///` doc covers:
    - [ ] What it does.
    - [ ] Parameters and their meaning.
    - [ ] Return value behavior.
    - [ ] Edge cases (`# Panics`, `# Errors`).
    - [ ] Usage example, `# Examples`.

📑 Traits
- [ ] Explain the **purpose** of the trait (marker? dynamic dispatch?).
- [ ] Doc for each method — include **when/why** to implement it.
- [ ] Document clearly default implemented methods and when to override.

📦 Public Constants
- [ ] Document what they configure and when you'd want to use them.

### 📌 Best Practices
* ✅ Use examples generously — they double as test cases.
* ✅ Prefer clarity over formality — it's for humans, not machines.
* ✅ Prefer doc comments to explain usage, and leave implementation details to code comments if needed.
* ✅ Use `cargo doc --open` to check your output often.
* ✅ Add `#![deny(missing_docs)]` and other relevant doc lints in top-level modules if you want to enforce full doc coverage.
