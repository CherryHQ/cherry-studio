# Chapter 7 - Type State Pattern

Models state at compile time, preventing bugs by making illegal states unrepresentable. It takes advantage of the Rust generics and type system to create sub-types that can only be reached if a certain condition is achieved, making some operations illegal at compile time. 

> Recently it became the standard design pattern of Rust programming. However, it is not exclusive to Rust, as it is achievable and has inspired other languages to do the same [swift](https://swiftology.io/articles/typestate/) and [typescript](https://catchts.com/type-state).

## 7.1 What is Type State Pattern?

**Type State Pattern** is a design pattern where you encode different **states** of the system as **types**, not as runtime flags or enums. This allows the compiler to enforce state transitions and prevent illegal actions at compile time. It also improves the developer experience, as developers only have access to certain functions based on the state of the type.

> Invalid states become compile errors instead of runtime bugs.

## 7.2 Why use it?

* Avoids runtime checks for state validity. If you reach certain states, you can make certain assumptions of the data you have.
* Models state transitions as type transitions. This is similar to a state machine, but in compile time.
* Prevents data misuse, e.g. using uninitialized objects.
* Improves API safety and correctness.
* The phantom data field is removed after compilation so no extra memory is allocated.

## 7.3 Simple Example: File State

[Github Example](https://github.com/apollographql/rust-best-practices/tree/main/examples/simple-type-state)
```rust
use std::{io, path::{Path, PathBuf}};

struct FileNotOpened;
struct FileOpened;

#[derive(Debug)]
struct File<State> {
    /// Path to the opened file
    path: PathBuf,
    /// Open `File` handler
    handle: Option<std::fs::File>,
    /// Type state manager
    _state: std::marker::PhantomData<State>
}

impl File<FileNotOpened> {
    /// `open` is the only entry point for this struct.
    /// * When called with a valid path, it will return a `File<FileOpened>` with a valid `handler` and `path`
    /// * `open` serves as an alternative to `new` and `defaults` methods (usable when your struct needs valid data to exist).
    fn open(path: &Path) -> io::Result<File<FileOpened>> {
        // If file is invalid, it will return `std::io::Error`
        let file = std::fs::File::open(path)?;
        Ok(
            File {
                path: path.to_path_buf(),
                // Always valid
                handle: Some(file),
                _state: std::marker::PhantomData::<FileOpened>
            }
        )
    }
}

impl File<FileOpened> {
    /// Reads the content of the `File` as a `String`.
    /// `read` can only be called by state `File<FileOpened>`
    fn read(&mut self) -> io::Result<String> {
        use io::Read;

        let mut content = String::new();
        let Some(handle)= self.handle.as_mut() else {
            unreachable!("Safe to unwrap as state can only be reached when file is open");
        };
        handle.read_to_string(&mut content)?;
        Ok(content)
    }

    /// Returns the valid path buffer.
    fn path(&self) -> &PathBuf {
        &self.path
    }
}
```

## 7.4 Real-World Examples

### Builder Pattern with Compile-Time Guarantees

> Forces the user to **set required fields** before calling `.build()`.

[Github Example](https://github.com/apollographql/rust-best-practices/tree/main/examples/type-state-builder)

A type-state pattern can have more than one associated states:

```rust
use std::marker::PhantomData;

struct MissingName;
struct NameSet;
struct MissingAge;
struct AgeSet;

#[derive(Debug)]
struct Person {
    name: String,
    age: u8,
    email: Option<String>,
}

struct Builder<NameState, AgeState> {
    name: Option<String>,
    age: u8,
    email: Option<String>,
    _name_marker: PhantomData<NameState>,
    _age_marker: PhantomData<AgeState>,
}

impl Builder<MissingName, MissingAge> {
    fn new() -> Self {
        Builder { name: None, age: 0, _name_marker: PhantomData, _age_marker: PhantomData, email: None }
    }

    fn name(self, name: String) -> Builder<NameSet, MissingAge> {
        Builder { name: Some(name), _name_marker: PhantomData::<NameSet>, age: self.age, _age_marker: PhantomData, email: None }
    }

    fn age(self, age: u8) -> Builder<MissingName, AgeSet> {
        Builder { age, _age_marker: PhantomData::<AgeSet>, name: None, _name_marker: PhantomData, email: None }
    }
}

impl Builder<NameSet, MissingAge> {
    fn age(self, age: u8) -> Builder<NameSet, AgeSet> {
        Builder { age, _age_marker: PhantomData::<AgeSet>, name: self.name, _name_marker: PhantomData::<NameSet>, email: None }
    }
}

impl Builder<MissingName, AgeSet> {
    fn email(self, email: String) -> Self {
        Self { name: self.name , age: self.age , email: Some(email) , _name_marker: self._name_marker , _age_marker: self._age_marker }
    }

    fn name(self, name: String) -> Builder<NameSet, AgeSet> {
        Builder { name: Some(name), _name_marker: PhantomData::<NameSet>, age: self.age, _age_marker: PhantomData::<AgeSet>, email: self.email }
    }
}

impl Builder<NameSet, AgeSet> {
    fn build(self) -> Person {
        Person { 
            name: self.name.unwrap_or_else(|| unreachable!("Name is guarantee to be set")), 
            age: self.age,
            email: self.email,
        }
    }
}
```

Although a bit more verbose than a usual builder, this guarantees that all necessary fields are present (note that e-mail is optional field only present in the final builder).

#### Usage:
```rust
// ✅ Valid cases
let person: Person = Builder::new().name("name".to_string()).age(30).build();
let person: Person = Builder::new().age(30).name("name".to_string()).build();
let person: Person = Builder::new().age(30).name("name".to_string()).email("myself@email.com".to_string()).build();

// ❌ Invalid cases
let person: Person = Builder::new().name("name".to_string()).build(); // ❌ Compile error: Age required to `build`
let person: Person = Builder::new().age(30).build(); // ❌ Compile error: Name required to `build`
let person: Person = Builder::new().age(30).email("myself@email.com".to_string()).build(); // ❌ Compile error: Name required to `build`
let person: Person = Builder::new().build();// ❌ Compile error: Name and Age required to `build`
```

### Network Protocol State Machine

Illegal transitions like sending a message before connecting **simply don't compile**:

```rust
// Mock example
struct Disconnected;
struct Connected;

struct Client<State> {
    stream: Option<std::net::TcpStream>,
    _state: std::marker::PhantomData<State>
}

impl Client<Disconnected> {
    fn connect(addr: &str) -> std::io::Result<Client<Connected>> {
        let stream = std::net::TcpStream::connect(addr)?;
        Ok(Client {
            stream: Some(stream),
            _state: std::marker::PhantomData::<Connected>
        })
    }
}

impl Client<Connected> {
    fn send(&mut self, msg: &str) {
        use std::io::Write;
        let Some(stream) = self.stream.as_mut() else {
            unreachable!("Stream is guarantee to be set");
        };
        stream.write_all(msg.as_bytes())
    }
}
```

## 7.5 Pros and Cons

### ✅ Use Type-State Pattern When:
* Your want **compile-time state safety**.
* You need to enforce **API constraints**.
* You are writing a library/crate that is heavy dependent on variants.
* Your want to replace runtime booleans or enums with **type-safe code paths**.
* You need compile time correctness.

### ❌ Avoid it when:
* Writing trivial states like enums.
* Don't need type-safety.
* When it leads to overcomplicated generics.
* When runtime flexibility is required.

### 🚨 Downsides and Cautions
* Can lead to more **verbose solutions**.
* Can lead to **complex type signatures**.
* May require **unsafe** to return **variant outputs** based on different states.
* May required a bunch of duplication (e.g. same struct field reused).
* PhantomData is not intuitive for beginners and can feel a bit hacky.

> Use this pattern when it **saves bugs, increases safety or simplifies logic**, not just for cleverness.
