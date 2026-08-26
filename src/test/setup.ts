import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom's Storage implementation is not always attached to `window` depending
// on jsdom/vitest version and environment options (observed: jsdom 30 +
// vitest 4 leaves `window.localStorage` undefined without a live browser
// context). The app's own code only ever uses the Web Storage API surface
// (getItem/setItem/removeItem/clear), so a minimal in-memory polyfill is
// enough to make storage-backed code testable regardless of jsdom's behaviour.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
}

if (typeof window.localStorage === 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
  })
}
if (typeof window.sessionStorage === 'undefined') {
  Object.defineProperty(window, 'sessionStorage', {
    value: createMemoryStorage(),
    configurable: true,
  })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
})
