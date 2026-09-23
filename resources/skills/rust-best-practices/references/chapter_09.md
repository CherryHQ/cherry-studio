# Chapter 9 - Understanding Pointers

Many higher level languages hide memory management, typically **passing by value** (copy data) or **passing by reference** (reference to shared data) without worrying about allocation, heap, stack, ownership and lifetimes, it is all delegated to the garbage collector or VM. Here is a comparison on this topic between a few languages:

### 📌 Language Comparison 

| Language | Value Types | Reference/Pointer Types | Async Model & Types | Manual Memory |
|------------ |------------------------------------- |----------------------------------------------------------- |---------------------------------------------------------------------------- |------------------------------ |
| Python | None | Everything is a reference | async def, await, Task, coroutines and asyncio.Future | ❌ Not Allowed |
| Javascript | Primitives | Objects | `async/await`, `Promise`, `setTimeout`. single threaded event loop | ❌ Not Allowed |
| Java | Primitives | Objects | `Future<T>`, threads, Loom (green threads) | ❌ Almost none & not recommended |
| Go | Values are copied unless using `&T` | Pointers (`*T`, `&T`), escape analysis | goroutines, `channels`, `sync.Mutex`, `context.Context` | ⚠️ Limited |
| C | Primitives and structs supported | Raw pointers `T*` and `*void` | Threads, event loops (`libuv`, `libevent`) | ✅ Fully |
| C++ | Primitives and references | Raw `T*` and smart pointers `shared_ptr` and `unique_ptr` | threads, `std::future`, `std::async`, (since c++ 20 `co_await/coroutines`) | ✅ Mostly |
| Rust | Primitives, Arrays, `impl Copy` | `&T`, `&mut T`, `Box<T>`, `Arc<T>` | `async/await`, `tokio`, `Future`, `JoinHandle`, `Send + Sync` | ✅🔒 Safe and Explicit |

## 9.1 Thread Safety

Rust tracks pointers using `Send` and `Sync` traits:
- `Send` means data can move across threads.
- `Sync` means data can be referenced from multiple threads.

> A pointer is thread-safe only if the data behind it is.

| Pointer Type | Short Description | Send + Sync? | Main Use |
|---------------- |--------------------------------------------------------------------------- |-------------------------------------- |------------ |
| `&T` | Shared reference | Yes | Shared access |
| `&mut T` | Exclusive mutable reference | No, not Send | Exclusive mutation |
| `Box<T>` | Heap-allocated owning pointer | Yes, if T: Send + Sync | Heap allocation |
| `Rc<T>` | Single-threaded ref counted pointer | No, neither | Multiple owners (single-thread) |
| `Arc<T>` | Atomic ref counter pointer | Yes | Multiple owners (multi-thread) |
| `Cell<T>` | Interior mutability for copy types | No, not Sync | Shared mutable, non-threaded |
| `RefCell<T>` | Interior mutability (dynamic borrow checker) | No, not Sync | Shared mutable, non-threaded |
| `Mutex<T>` | Thread-safe interior mutability with exclusive access | Yes | Shared mutable, threaded |
| `RwLock<T>` | Thread-safe shared readonly access OR exclusive mutable access | Yes | Shared mutable, threaded |
| `OnceCell<T>` | Single-thread one-time initialization container (interior mutability ONCE) | No, not Sync | Simple lazy value initialization |
| `LazyCell<T>` | A lazy version of `OnceCell<T>` that calls function closure to initialize | No, not Sync | Complex lazy value initialization |
| `OnceLock<T>` | Thread-safe version of `OnceCell<T>` | Yes | Multi-thread single init |
| `LazyLock<T>` | Thread-safe version of `LazyCell<T>` | Yes | Multi-thread complex init |
| `*const T/*mut T` | Raw Pointers | No, user must ensure safety manually | Raw memory / FFI |

## 9.2 When to use pointers:

### `&T` - Shared Borrow:

Probably the most common type in a Rust code base, it is **Safe, with no mutation** and allows **multiple readers**.

```rust
let data: String = String::from_str("this a string").unwrap();

print_len(&data);
print_capacity(&data);
print_bytes(&data);

fn print_len(s: &str) {
    println!("{}", s.len())
}

fn print_capacity(s: &String) {
    println!("{}", s.capacity())
}

fn print_bytes(s: &String) {
    println!("{:?}", s.as_bytes())
}
```
### `&mut T` - Exclusive Borrow:

Probably the most common *mutable* type in a Rust code base, it is **Safe, but only allows one mutable borrow at a time**.

```rust
let mut data: String = String::from_str("this a string").unwrap();
mark_update(&mut data);

fn mark_update(s: &mut String) {
    s.push_str("_update");
}
```

### [`Box<T>`](https://doc.rust-lang.org/std/boxed/struct.Box.html) - Heap Allocated

Single-owner heap-allocated data, great for recursive types and large structs.

```rust
pub enum MySubBoxedEnum<T> {
    Single(T),
    Double(Box<MySubBoxedEnum<T>>, Box<MySubBoxedEnum<T>>),
    Multi(Vec<T>), // Note that Vec is already a boxed value
}
```

### [`Rc<T>`](https://doc.rust-lang.org/std/rc/struct.Rc.html) - Reference Counter (single-thread)

You need multiple references to data in a single thread. Most common example is linked-list implementation.

### [`Arc<T>`](https://doc.rust-lang.org/std/sync/struct.Arc.html) - Atomic Reference Counter (multi-thread)

You need multiple references to data in multiple threads. Most common use cases is sharing readonly Vec across thread with `Arc<[T]>` and wrapping a `Mutex` so it can be easily shared across threads, `Arc<Mutex<T>>`.

### [`RefCell<T>`](https://doc.rust-lang.org/std/cell/struct.RefCell.html) - Runtime checked interior mutability

Used when you need shared access and the ability to mutate date, borrow rules are enforced at runtime. **It may panic!**.

```rust
use std::cell::RefCell;
let x = RefCell::new(42);
*x.borrow_mut() += 1;

assert_eq!(&*x.borrow(), 42, "Not meaning of life");
```

Panic example:
```rust
use std::cell::RefCell;
let x = RefCell::new(42);

let borrow = x.borrow();

let mutable = x.borrow_mut();
```

### [`Cell<T>`](https://doc.rust-lang.org/std/cell/struct.Cell.html) - Copy-only interior mutability

Somewhat the fast and safe version of `RefCell`, but it is limited to types that implement the `Copy` trait:

```rust
use std::cell::Cell;

struct SomeStruct {
    regular_field: u8,
    special_field: Cell<u8>,
}

let my_struct = SomeStruct {
    regular_field: 0,
    special_field: Cell::new(1),
};

let new_value = 100;

// ERROR: `my_struct` is immutable
// my_struct.regular_field = new_value;

// WORKS: although `my_struct` is immutable, `special_field` is a `Cell`,
// which can always be mutated with copy values
my_struct.special_field.set(new_value);
assert_eq!(my_struct.special_field.get(), new_value);
```

### [`Mutex<T>`](https://doc.rust-lang.org/std/sync/struct.Mutex.html) - Thread-safe mutability

An exclusive access pointer that allows a thread to read/write the data contained inside. It is usually wrapped in an `Arc` to allow shared access to the Mutex.

### [`RwLock<T>`](https://doc.rust-lang.org/std/sync/struct.RwLock.html) - Thread-safe mutability

Similar to a `Mutex`, but it allows multiple threads to read it OR a single thread to write. It is usually wrapped in an `Arc` to allow shared access to the RwLock.


### [`*const T/*mut T`](https://doc.rust-lang.org/std/primitive.pointer.html) - Raw pointers

Inherently **unsafe** and necessary for FFI. Rust makes their usage explicit to avoid accidental misuse and unwilling manual memory management.

```rust
let x = 5;
let ptr = &x as *const i32;
unsafe {
    println!("PTR is {}", *ptr)
}
```

### [`OnceCell`](https://doc.rust-lang.org/std/cell/struct.OnceCell.html) - Single-thread single initialization container

Most useful when you need to share a configuration between multiple data structures.

```rust
use std::{cell::OnceCell, rc::Rc};

#[derive(Debug, Default)]
struct MyStruct {
    distance: usize,
    root: Option<Rc<OnceCell<MyStruct>>>, 
}

fn main() {
    let root = MyStruct::default();
    let root_cell = Rc::new(OnceCell::new());
    if let Err(previous) = root_cell.set(root) {
        eprintln!("Previous Root {previous:?}");
    }
    let child_1 = MyStruct{
        distance: 1,
        root: Some(root_cell.clone())
    };

    let child_2 = MyStruct{
        distance: 2,
        root: Some(root_cell.clone())
    };


    println!("Child 1: {child_1:?}");
    println!("Child 2: {child_2:?}");
}
```

### [`LazyCell`](https://doc.rust-lang.org/std/cell/struct.LazyCell.html) - Lazy initialization of `OnceCell`

Useful when the initialized data can be delayed to when it is actually being called.

### [`OnceLock`](https://doc.rust-lang.org/std/sync/struct.OnceLock.html) - thread-safe `OnceCell`

Useful when you need a `static` value.

```rust
use std::sync::OnceLock;

static CELL: OnceLock<u32> = OnceLock::new();

// `OnceLock` has not been written to yet.
assert!(CELL.get().is_none());

// Spawn a thread and write to `OnceLock`.
std::thread::spawn(|| {
    let value = CELL.get_or_init(|| 12345);
    assert_eq!(value, &12345);
})
.join()
.unwrap();

// `OnceLock` now contains the value.
assert_eq!(
    CELL.get(),
    Some(&12345),
);
```

### [`LazyLock`](https://doc.rust-lang.org/std/sync/struct.LazyLock.html) - thread-safe `LazyCell`

Similar to `OnceLock`, but the static value is a bit more complex to initialize.

```rust
use std::sync::LazyLock;

static CONFIG: LazyLock<HashMap<&str, T>> = LazyLock::new(|| {
    let data = read_config();
    let mut config: HashMap<&str, T> = data.into();
    config.insert("special_case", T::default());
    config
});

let _ = &*CONFIG;
```

## References
- [Mara Bos - Rust Atomics and Locks](https://marabos.nl/atomics/)
- [Semicolon video on pointers](https://www.youtube.com/watch?v=Ag_6Q44PBNs)
