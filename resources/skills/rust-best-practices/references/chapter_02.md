# Chapter 2 - Clippy and Linting Discipline

Be sure to have `cargo clippy` installed with your rust compiler, run `cargo clippy -V` in your terminal for a rust project and you should get something like this `clippy 0.1.86 (05f9846f89 2025-03-31)`. If terminal fails to show a clippy version, please run the following code `rustup update && rustup component add clippy`.

Clippy documentation can be found [here](https://doc.rust-lang.org/clippy/usage.html).

## 2.1 Why care about linting?

Rust compiler is a powerful tool that catches many mistakes. However, some more in-depth analysis require extra tools, that is where `cargo clippy` clippy comes into to play. Clippy checks for:
* Performance pitfalls.
* Style issues.
* Redundant code.
* Potential bugs.
* Non-idiomatic Rust.

## 2.2 Always run `cargo clippy`

Add the following to your daily workflow:

```shell
$ cargo clippy --all-targets --all-features --locked -- -D warnings
```

* `--all-targets`: checks library, tests, benches and examples.
* `--all-features`: checks code for all features enabled, auto solves conflicting features.
* `--locked`: Requires `Cargo.lock` to be up-to-date, can be solved with `$ cargo update`.
* `-D warnings`: treats warnings as errors

Potential additions elements to add:

* `-- -W clippy::pedantic`: lints which are rather strict or have occasional false positives.
* `-- -W clippy::nursery`: Optionally can be added to check for new lints that are still under development.
* ❗ Add this to your Makefile, Justfile, xtask or CI Pipeline.

> Example at ApolloGraphQL
>
> In the `Router` project there is a `xtask` configured for linting that can be executed with `cargo xtask lint`. 

## 2.3 Important Clippy Lints to Respect

| Lint Name | Why | Link |
| --------- | ----| -----|
| `redundant_clone` | Detects unnecessary `clones`, has performance impact | [link (nursery + perf)](https://rust-lang.github.io/rust-clippy/master/#redundant_clone) |
| `needless_borrow` group | Removes redundant `&` borrowing | [link (style)](https://rust-lang.github.io/rust-clippy/master/#needless_borrow) |
| `map_unwrap_or` / `map_or` | Simplifies nested `Option/Result` handling | [`map_unwrap_or`](https://rust-lang.github.io/rust-clippy/master/#map_unwrap_or) [`unnecessary_map_or`](https://rust-lang.github.io/rust-clippy/master/#unnecessary_map_or) [`unnecessary_result_map_or_else`](https://rust-lang.github.io/rust-clippy/master/#unnecessary_result_map_or_else) |
| `manual_ok_or` | Suggest using `.ok_or_else` instead of `match` | [link (style)](https://rust-lang.github.io/rust-clippy/master/#manual_ok_or) |
| `large_enum_variant` | Warns if an enum has very large variant which is bad for memory. Suggests `Boxing` it | [link (perf)](https://rust-lang.github.io/rust-clippy/master/#large_enum_variant) |
| `unnecessary_wraps` | If your function always returns `Some` or `Ok`, you don't need `Option`/`Result` | [link (pedantic)](https://rust-lang.github.io/rust-clippy/master/#unnecessary_wraps) |
| `clone_on_copy` | Catches accidental `.clone()` on `Copy` types like `u32` and `bool` | [link (complexity)](https://rust-lang.github.io/rust-clippy/master/#clone_on_copy) |
| `needless_collect` | Prevents collecting and allocating an iterator, when allocation is not needed | [link (nursery)](https://rust-lang.github.io/rust-clippy/master/#needless_collect) |

## 2.4 Fix warnings, don't silence them!

**NEVER** just `#[allow(clippy::lint_something)]` unless:

* You **truly understand** why the warning happens and you have a reason why it is better that way.
* You **document** why it is being ignored.
* ❗ Don't use `allow`, but `expect`, it will give a warning in case the lint is not true anymore, `#[expect(clippy::lint_something)]`.

### Example:

```rust
// Faster matching is preferred over size efficiency
#[expect(clippy::large_enum_variant)]
enum Message {
    Code(u8),
    Content([u8; 1024]),
}
```

> The fix would be:
> 
> ```rust
> // Faster matching is preferred over size efficiency
> #[expect(clippy::large_enum_variant)]
> enum Message {
>     Code(u8),
>     Content(Box<[u8; 1024]>),
> }
> ```

### Handling false positives

Sometimes Clippy complains even when your code is correct, in those cases there are two solutions:
1. Try to refactor the code, so it improves the warning.
2. **Locally** override the lint with `#[expect(clippy::lint_name)]` and a comment with the reason.
3. Avoid global overrides, unless it is core crate issue, a good example of this is the Bevy Engine that has a set of lints that should be allowed by default.

## 2.5 Configure workspace/package lints

In your `Cargo.toml` file it is possible to determine which lints and their priorities over each other. In case of 2 or more conflicting lints, the higher priority one will be chosen. Example configuration for a package:

```toml
[lints.rust]
future-incompatible = "warn"
nonstandard_style = "deny"

[lints.clippy]
all = { level = "deny", priority = 10 }
redundant_clone = { level = "deny", priority = 9 }
manual_while_let_some = { level = "deny", priority = 4 }
pedantic = { level = "warn", priority = 3 }
```

And for a workspace:

```toml
[workspace.lints.rust]
future-incompatible = "warn"
nonstandard_style = "deny"

[workspace.lints.clippy]
all = { level = "deny", priority = 10 }
redundant_clone = { level = "deny", priority = 9 }
manual_while_let_some = { level = "deny", priority = 4 }
pedantic = { level = "warn", priority = 3 }
```
