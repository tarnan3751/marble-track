// Small seeded PRNG (mulberry32) so a run can be reproduced from its seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.seed = seed;
    this.f = mulberry32(seed);
  }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.f() < p; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  weighted(items) {
    // items: [{ k, w }]
    let total = 0;
    for (const it of items) total += it.w;
    let r = this.f() * total;
    for (const it of items) {
      r -= it.w;
      if (r <= 0) return it.k;
    }
    return items[items.length - 1].k;
  }
}
