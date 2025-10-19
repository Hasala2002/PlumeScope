type Entry<T> = { value: T; expiresAt: number };

export class LRUCache<T = any> {
  private max: number;
  private defaultTtlMs: number;
  private map: Map<string, Entry<T>>;

  constructor(max = 500, defaultTtlMs = 6 * 60 * 60 * 1000) {
    this.max = max;
    this.defaultTtlMs = defaultTtlMs;
    this.map = new Map();
  }

  private now() {
    return Date.now();
  }

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh LRU order
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      const lruKey = this.map.keys().next().value;
      if (lruKey !== undefined) this.map.delete(lruKey);
    }
    this.map.set(key, { value, expiresAt: this.now() + (ttlMs ?? this.defaultTtlMs) });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

export const cache = new LRUCache<any>();

export function cacheKey(type: string, lat: number, lon: number, date: string) {
  // round lat/lon to 4 decimals to increase hit rate while being precise ~11m
  const r = (x: number) => x.toFixed(4);
  return `hazard:${type}:${r(lat)}:${r(lon)}:${date}`;
}

export function todayUTC(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
