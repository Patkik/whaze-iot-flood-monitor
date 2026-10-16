import { useSyncExternalStore } from 'react';

/** Tiny persisted store: one localStorage key, subscribe-able, React hook friendly. */
export function createStore<T>(key: string, initial: T) {
  const listeners = new Set<() => void>();
  let cache: T = read();

  function read(): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw);
      return Array.isArray(initial) ? (parsed as T) : { ...initial, ...parsed };
    } catch {
      return initial;
    }
  }

  function set(next: T | ((prev: T) => T)) {
    cache = typeof next === 'function' ? (next as (p: T) => T)(cache) : next;
    try {
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {
      /* storage full or blocked: keep in-memory value */
    }
    listeners.forEach((l) => l());
  }

  function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  window.addEventListener('storage', (e) => {
    if (e.key === key) {
      cache = read();
      listeners.forEach((l) => l());
    }
  });

  return {
    get: () => cache,
    set,
    use: () => useSyncExternalStore(subscribe, () => cache),
  };
}
