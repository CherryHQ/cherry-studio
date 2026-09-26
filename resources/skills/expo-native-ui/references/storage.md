# Storage

## Key-Value Storage

Use the localStorage polyfill for key-value storage. **Never use AsyncStorage**

```tsx
import "expo-sqlite/localStorage/install";

// Simple get/set
localStorage.setItem("key", "value");
localStorage.getItem("key");

// Store objects as JSON
localStorage.setItem("user", JSON.stringify({ name: "John", id: 1 }));
const user = JSON.parse(localStorage.getItem("user") ?? "{}");
```

## When to Use What

| Use Case                                             | Solution                |
| ---------------------------------------------------- | ----------------------- |
| Simple key-value (settings, preferences, small data) | `localStorage` polyfill |
| Large datasets, complex queries, relational data     | Full `expo-sqlite`      |
| Sensitive data (tokens, passwords)                   | `expo-secure-store`     |

## Storage with React State

Create a storage utility with subscriptions for reactive updates:

```tsx
// utils/storage.ts
import "expo-sqlite/localStorage/install";

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export const storage = {
  get<T>(key: string, defaultValue: T): T {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : defaultValue;
  },

  set<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
    listeners.get(key)?.forEach((fn) => fn());
  },

  subscribe(key: string, listener: Listener): () => void {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(listener);
    return () => listeners.get(key)?.delete(listener);
  },
};
```

## React Hook for Storage

```tsx
// hooks/use-storage.ts
import { useSyncExternalStore } from "react";
import { storage } from "@/utils/storage";

export function useStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    (cb) => storage.subscribe(key, cb),
    () => storage.get(key, defaultValue)
  );

  return [value, (newValue: T) => storage.set(key, newValue)];
}
```

Usage:

```tsx
function Settings() {
  const [theme, setTheme] = useStorage("theme", "light");

  return (
    <Switch
      value={theme === "dark"}
      onValueChange={(dark) => setTheme(dark ? "dark" : "light")}
    />
  );
}
```

## Full SQLite for Complex Data

For larger datasets or complex queries, use expo-sqlite directly:

```tsx
import * as SQLite from "expo-sqlite";

const db = await SQLite.openDatabaseAsync("app.db");

// Create table
await db.execAsync(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    location TEXT
  )
`);

// Insert
await db.runAsync("INSERT INTO events (title, date) VALUES (?, ?)", [
  "Meeting",
  "2024-01-15",
]);

// Query
const events = await db.getAllAsync("SELECT * FROM events WHERE date > ?", [
  "2024-01-01",
]);
```
