const entries = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return entries.size
  },
  clear() {
    entries.clear()
  },
  getItem(key) {
    return entries.get(String(key)) ?? null
  },
  key(index) {
    return Array.from(entries.keys())[index] ?? null
  },
  removeItem(key) {
    entries.delete(String(key))
  },
  setItem(key, value) {
    entries.set(String(key), String(value))
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})
