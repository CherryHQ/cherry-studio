# Chapter 5 - Automated Testing

> Tests are not just for correctness. They are the first place people look to understand how your code works.

* Tests in rust are declared with the attribute macro `#[test]`. Most code editors can compile and run the functions declared under the macro individually or blocks of them.
* Test can have special compilation flags with `#[cfg(test)]`. Also executable in code editors if it contained `#[test]`, it is a good way to mock complicated functions or override traits.

## 5.1 Tests as Living Documentation

In Rust, as in many other languages, tests often show how the functions are meant to be used. If a test is clear and targeted, it's often more helpful than reading the function body, when combined with other tests, they serve as living documentation.

### Use descriptive names

> In the unit test name we should see the following:
> * `unit_of_work`: which *function* we are calling. The **action** that will be executed. This is often be the name of the the test `mod` where the function is being tested.
```rust
#[cfg(test)] 
mod test { 
    mod function_name { 
        #[test] 
        fn returns_y_when_x() { ... } 
    } 
}
```
> * `expected_behavior`: the set of **assertions** that we need to verify that the test works.
> * `state_that_the_test_will_check`: the general **arrangement**, or setup, of the specific test case.

#### ❌ Don't use a generic name for a test
```rust
#[test]
fn test_add_happy_path() {
    assert_eq!(add(2, 2), 4);
}
```
#### ✅ Use a name which reads like a sentence, describing the desired behavior
> Alternatively, if you function has too many tests, you can blob them together in a `mod`, it makes it easier to read and navigate.

```rust
// OPTION 1
#[test]
fn process_should_return_blob_when_larger_than_b() {
    let a = setup_a_to_be_xyz();
    let b = Some(2);
    let expected = MyExpectedStruct { ... };

    let result = process(a, b).unwrap();

    assert_eq!(result, expected);
}

// OPTION 2
mod process {
    #[test]
    fn should_return_blob_when_larger_than_b() {
        let a = setup_a_to_be_xyz();
        let b = Some(2);
        let expected = MyExpectedStruct { ... };

        let result = process(a, b).unwrap();

        assert_eq!(result, expected);
    }
}
```

> When executing `cargo test` the test output for each option will look like:
> Option 1: `process_should_return_blob_when_larger_than_b`.
> Option 2: `process::should_return_blob_when_larger_than_b`.

### Use modules for organization

Most IDEs can run a single module of tests all together.
The test name in the output will also contain the name of the module.
Together, that means you can use the module name to group related tests together:

```rust
#[cfg(test)]
mod test { // IDEs will provide a ▶️ button here

    mod process {
        #[test] // IDEs will provide a ▶️ button here
        fn returns_error_xyz_when_b_is_negative() {
            let a = setup_a_to_be_xyz();
            let b = Some(-5);
            let expected = MyError::Xyz;
            
            let result = process(a, b).unwrap_err();
            
            assert_eq!(result, expected);
        }

        #[test] // IDEs will provide a ▶️ button here
        fn returns_invalid_input_error_when_a_and_b_not_present() {
            let a = None;
            let b = None;
            let expected = MyError::InvalidInput;

            let result = process(a, b).unwrap_err();

            assert_eq!(result, expected);
        }
    }
}
```

### Only test one behavior per function

To keep tests clear, they should describe _one_ thing that the unit does.
This makes it easier to understand why a test is failing.

#### ❌ Don't test multiple things in the same test
```rust
fn test_thing_parser(...) {
    assert!(Thing::parse("abcd").is_ok());
    assert!(Thing::parse("ABCD").is_err());
}
```

#### ✅ Test one thing per test
```rust
#[cfg(test)]
mod test_thing_parser {
    #[test]
    fn lowercase_letters_are_valid() {
        assert!(
            Thing::parse("abcd").is_ok(),
            // Works like `eprintln`, `format` and `println` macros
            "Thing parse error: {:?}", 
            Thing::parse("abcd").unwrap_err()
        );
    }

    #[test]
    fn capital_letters_are_invalid() {
        assert!(Thing::parse("ABCD").is_err());
    }
}
```

> `Ok` scenarios should have an `eprintln` of the `Err` case.

### Use very few, ideally one, assertion per test

When there are multiple assertions per test, it's both harder to understand the intended behavior and 
often requires many iterations to fix a broken test, as you work through assertions one by one.

❌ Don't include many assertions in one test:

```rust
#[test]
fn test_valid_inputs() {
    assert!(the_function("a").is_ok());
    assert!(the_function("ab").is_ok());
    assert!(the_function("ba").is_ok());
    assert!(the_function("bab").is_ok());
}
```

If you are testing separate behaviors, make multiple tests each with descriptive names.
To avoid boilerplate, either use a shared setup function or [rstest](https://crates.io/crates/rstest) cases *with descriptive test names*:
```rust
#[rstest]
#[case::single("a")]
#[case::first_letter("ab")]
#[case::last_letter("ba")]
#[case::in_the_middle("bab")]
fn the_function_accepts_all_strings_with_a(#[case] input: &str) {
    assert!(the_function(input).is_ok());
}
```

> Considerations when using `rstest`
>
> * It's harder for both IDEs and humans to run/locate specific tests.
> * Expectation vs condition naming is now visually inverted (expectation first).

> ❗ Share **setup**, not the test itself: keep each test's action and assertion inline, even when repetitive. Tests tolerate duplication better than production code -- see [Chapter 1, §1.8](./chapter_01.md#-test-code-readability-beats-dry).

## 5.2 Add Test Examples to your Docs

We will deep dive into docs at a later stage, so in this section we will just briefly go over how to add tests to you docs. Rustdoc can turn examples into executable tests using `///` with a few advantages:

* These tests run with `cargo test` **BUT NOT** `cargo nextest run`. If using `nextest`, make sure to run `cargo t --doc` separately.
* They serve both as documentation and correctness checks, and are kept up to date by changes, due to the fact that the compiler checks them.
* No extra testing boilerplate. You can easily hide test sections by prefixing the line with `#`.
* ❗ There is no issue if you have test duplication between doc-tests and other non-public facing tests.

```rust
/// Helper function that adds any two numeric values together.
/// This function reasons about which would be the correct type to parse based on the type
/// and the size of the numeric value.
/// 
/// # Examples
/// 
/// ```rust
/// # use crate_name::generic_add;
/// use num::numeric;
/// 
/// # assert_eq!(
/// generic_add(5.2, 4) // => 9.2
/// # , 9.2)
/// 
/// # assert_eq!(
/// generic_add(2, 2.0) // => 4
/// # , 4)
/// ```
```

This documentation code would look like:
```rust
use num::numeric;

generic_add(5.2, 4) // => 9.2
generic_add(2, 2.0) // => 4
```

## 5.3 Unit Test vs Integration Tests vs Doc tests

As a general rule, without delving into *test pyramid naming*, rust has 3 sets of tests:

### Unit Test

Tests that go in the **same module** as the **tested unit** was declared, this allows the test runner to have visibility over private functions and parent `use` declarations. They can also consume `pub(crate)` functions from other modules if needed. Unit tests can be more focused on **implementation and edge-cases checks**.

* They should be as simple as possible, testing one state and one behavior of the unit. KISS.
* They should test for errors and edge cases.
* Different tests of the same unit can be combined under a single `#[cfg(test)] mod test_unit_of_work {...}`, allowing multiple submodules for different `units_of_work`.
* Try to keep external states/side effects to your API to minimum and focus those tests on the `mod.rs` files.
* Tests that are not yet fully implemented can be ignored with the `#[ignore = "optional message"]` attribute.
* Tests that intentionally panic should be annotated with the attribute `#[should_panic]`.

```rust
#[cfg(test)]
mod unit_of_work_tests {
    use super::*;

    #[test]
    fn unit_state_behavior() {
        let expected = ...;
        let result = ...;
        assert_eq!(result, expected, "Failed because {}", result - expected);
    }
}
```

### Integration Tests

Tests that go under the `tests/` directory, they are entirely external to your library and use the same code as any other code would use, not have access to private and crate level functions, which means they can **only test** functions on your **public API**. 

> Their purpose is to test whether many parts of the code work together correctly, units of code that work correctly on their own could have problems when integrated.

* Test for happy paths and common use cases.
* Allow external states and side effects, [testcontainers](https://rust.testcontainers.org/) might help.
* if testing binaries, try to break **executable** and **functions** into `src/main.rs` and `src/lib.rs`, respectively.

```
├── Cargo.lock 
├── Cargo.toml 
├── src 
│   └── lib.rs 
└── tests 
    ├── mod.rs 
    ├── common 
    │   └── mod.rs 
    └── integration_test.rs
```

### Doc Testing

As mentioned in section [5.2](#52-add-test-examples-to-your-docs), doc tests should have happy paths, general public API usage and more powerful attributes that improve documentation, like custom CSS for the code blocks.

### Attributes:

* `ignore`: tells rust to ignore the code, usually not recommended, if you want just a code formatted text, use `text`.
* `should_panic`: tells the rust compiler that this example block will panic.
* `no_run`: compiles but doesn't execute the code, similar to `cargo check`. Very useful when dealing with side-effects for documentation.
* `compile_fail`: Test rustdoc that this block should cause a compilation fail, important when you want to demonstrate wrong use cases.

## 5.4 How to `assert!`

Rust comes with 2 macros to make assertions:
* `assert!` for asserting boolean values like `assert!(value.is_ok(), "'value' is not Ok: {value:?}")`
* `assert_eq!` for checking equality between two different values, `assert_eq!(result, expected, "'result' differs from 'expected': {}", result.diff(expected))`.

### 🚨 `assert!` reminders
* Rust asserts support formatted strings, like the previous examples, those strings will be printed in case of failure, so it is a good practice to add what the actual state was and how it differs from the expected.
* If you don't care about the exact pattern matching value, using `matches!` combined with `assert!` might be a good alternative. Note the message string is an argument to `assert!`, not to `matches!`:
```rust
assert!(matches!(error, MyError::BadInput(_)), "Expected `BadInput`, found {error}");
```
* Since Rust 1.96 prefer the stabilized [`assert_matches!`](https://doc.rust-lang.org/std/macro.assert_matches.html) (and [`debug_assert_matches!`](https://doc.rust-lang.org/std/macro.debug_assert_matches.html)) over `assert!(matches!(..))`. It prints the actual value on failure for free, so you don't have to write the message yourself:
```rust
use std::assert_matches::assert_matches;

assert_matches!(error, MyError::BadInput(_));
```
* Use `#[should_panic]` wisely. It should only be used when panic is the desired behavior, prefer result instead of panic.
* There are some other that can enhance your testing experience like:
    * [`rstest`](https://crates.io/crates/rstest): fixture based test framework with procedural macros.
    * [`pretty_assertions`](https://crates.io/crates/pretty_assertions): overrides `assert_eq` and `assert_ne`, and creates colorful diffs between them.

## 5.5 Snapshot Testing with `cargo insta`

> When correctness is visual or structural, snapshots tell the story better than asserts.

1. Add to your dependencies:
```toml
insta = { version = "1.42.2", features = ["yaml"] }
```
> For most real world applications the recommendation is to use YAML snapshots of serializable values. This is because they look best under version control and the diff viewer and support redaction. To use this enable the yaml feature of insta.

2. For a better review experience, add the CLI `cargo install cargo-insta`.

3. Writing a simple test:
```rust
fn split_words(s: &str) -> Vec<&str> {
    s.split_whitespace().collect()
}

#[test]
fn test_split_words() {
    let words = split_words("hello from the other side");
    insta::assert_yaml_snapshot!(words);
}
```

4. Run `cargo insta test` to execute, and `cargo insta review` to review conflicts.

To learn more about `cargo insta` check out its [documentation](https://insta.rs/docs/quickstart/) as it is a very complete and well documented tool.

### What is snapshot testing?

Snapshot testing compares your output (text, Json, HTML, YAML, etc) against a saved "golden" version. On future runs, the test fails if the output changes, unless humanly approved. It is perfect for:
* Generate code.
* Serializing complex data.
* Rendered HTML.
* CLI output.

#### ❌ What not to test with snapshot
* Very stable, numeric-only or small structured data associated logic (prefer `assert_eq!`).
* Critical path logic (prefer precise unit tests).
* Flaky tests, randomly generated output, unless redacted.
* Snapshots of external resources, use mocks and stubs.

## 5.6 ✅ Snapshot Best Practices

* Named snapshots, it gives meaningful snapshot files names, e.g. `snapshots/this_is_a_named_snapshot.snap`
```rust
assert_snapshot!("this_is_a_named_snapshot", output);
```

* Keep snapshots small and clear. 
```rust
// ✅ Best case:
assert_snapshot!("app_config/http", whole_app_config.http);

// ❌ Worst case:
assert_snapshot!("app_config", whole_app_config); // Huge object
```

> #### 🚨 Avoid snapshotting huge objects 
> Huge objects become hard to review and reason about.

* Avoid snapshotting simple types (primitives, flat enums, small structs):
```rust
// ✅ Better:
assert_eq!(meaning_of_life, 42);

// ❌ OVERKILL:
assert_snapshot!("the_meaning_of_life", meaning_of_life); // meaning_of_life == 42
```

* Use [redactions](https://insta.rs/docs/redactions/) for unstable fields (randomly generated, timestamps, uuid, etc):
```rust
use insta::assert_json_snapshot;

#[test]
fn endpoint_get_user_data() {
    let data = http::client.get_user_data();
    assert_json_snapshot!(
        "endpoints/subroute/get_user_data",
        data,
        ".created_at" => "[timestamp]",
        ".id" => "[uuid]"
    );
}
```
* Commit your snapshots into git. They will be stored in `snapshots/` alongside your tests.
* Review changes carefully before accepting.
