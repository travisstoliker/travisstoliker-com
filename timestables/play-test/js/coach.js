// The coach: rates each player, predicts their chance on every question, and asks ones
// they'll get right about 80% of the time. A port of the app's Learning.swift.
import { ITEMS, findItem, ask, logit, sigmoid, groups, nowRef } from './modes.js';

export const FAST_SECS = 3.5, TARGET = 0.80, MIN_CLOCK = 4, MAX_CLOCK = 12;
export const newSkill = () => ({ theta: 0, numbers: {}, answers: 0, clock: 10 });

export function base(s, it) {
  const tags = [...new Set(it.tags)];
  const boost = tags.reduce((t, k) => t + (s.numbers[k] ?? 0), 0) / Math.max(1, tags.length);
  return sigmoid(logit(it.prior) + s.theta + boost);
}
const credit = h => (h.ok ? (h.secs <= FAST_SECS ? 1 : 0.75) : 0);

export function pCorrect(s, f, it) {
  const m = base(s, it);
  let alpha = 2 * m, beta = 2 * (1 - m);
  if (f) {
    if (!f.history?.length && f.seen > 0) { alpha += f.right * 0.8; beta += f.seen - f.right; }
    let w = 1;
    for (const h of [...(f.history ?? [])].reverse()) { const c = credit(h); alpha += w * c; beta += w * (1 - c); w *= 0.7; }
  }
  return alpha / (alpha + beta);
}

export function update(s, it, attempt) {
  const err = credit(attempt) - base(s, it);
  const k = Math.max(0.15, 0.9 / (1 + s.answers / 12));
  s.theta = Math.min(5, Math.max(-4, s.theta + k * err));
  for (const t of new Set(it.tags)) s.numbers[t] = Math.min(3, Math.max(-3, (s.numbers[t] ?? 0) + k * 0.8 * err));
  s.answers += 1;
}

export function rebuild(mem, op) {
  const s = newSkill();
  const tries = Object.entries(mem).flatMap(([k, f]) => (f.history ?? []).map(h => [k, h])).sort((x, y) => x[1].at - y[1].at);
  for (const [k, h] of tries) { const it = findItem(op, k); if (it) update(s, it, h); }
  return s;
}

function recentSuccess(mem, n = 12) {
  const recent = Object.values(mem).flatMap(f => f.history ?? []).sort((a, b) => b.at - a.at).slice(0, n);
  if (!recent.length) return [TARGET, 0];
  return [recent.filter(h => h.ok).length / recent.length, recent.length];
}
export function target(mem) {
  const [rate, n] = recentSuccess(mem);
  return n < 4 ? TARGET : Math.min(0.97, Math.max(0.55, TARGET + 1.2 * (TARGET - rate)));
}
export const recentKeys = (mem, n = 15) =>
  Object.entries(mem).flatMap(([k, f]) => (f.history ?? []).map(h => [k, h.at])).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);

/** Pick the next question: near the target chance, not asked lately, varied numbers. */
export function pick(op, s, mem, recent, game = []) {
  const t = target(mem), now = nowRef();
  const tags = k => new Set(findItem(op, k)?.tags ?? []);
  const gameTags = game.slice(0, 6).map(tags);
  const tagCount = {};
  for (const k of recent.slice(0, 15)) for (const n of tags(k)) tagCount[n] = (tagCount[n] ?? 0) + 1;
  const isSingle = k => { const it = findItem(op, k); return !!it && !it.isKind && new Set(it.tags).size === 1; };
  const scored = ITEMS[op].map(it => {
    const fact = mem[it.key], rw = it.isKind ? 0.35 : 1, mine = new Set(it.tags);
    let score = -Math.abs(pCorrect(s, fact, it) - t) * 4;
    const i = recent.indexOf(it.key);
    if (i >= 0) score -= rw * 2.5 * (1 - i / Math.max(1, recent.length));
    if (game.slice(0, 8).includes(it.key)) score -= rw * 2;
    gameTags.forEach((g, gi) => { if ([...g].some(x => mine.has(x))) score -= rw * (0.8 - 0.12 * gi); });
    for (const n of it.tags) score -= rw * 0.15 * (tagCount[n] ?? 0);
    if (!it.isKind && mine.size === 1) {
      if (recent.slice(0, 4).some(isSingle)) score -= 1.2;
      score -= 0.25 * recent.slice(0, 15).filter(isSingle).length;
    }
    score -= it.penalty;
    const last = fact?.history?.at(-1)?.at;
    if (last) score += Math.min(0.3, (now - last) / 86400 * 0.1);
    return [score, it];
  }).sort((a, b) => b[0] - a[0]).slice(0, 5);
  const w = scored.map(([sc]) => Math.exp((sc - scored[0][0]) * 3));
  let r = Math.random() * w.reduce((a, b) => a + b, 0), best = scored[0][1];
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { best = scored[i][1]; break; } }
  return ask(best);
}

export function adjustClock(op, s, mem, right, asked, secs) {
  if (asked < 4) return null;
  const acc = right / asked;
  const hardLeft = ITEMS[op].filter(it => !it.isKind && it.penalty === 0 && pCorrect(s, mem[it.key], it) < 0.85).length;
  const median = [...secs].sort((a, b) => a - b)[Math.floor(secs.length / 2)];
  let c = s.clock;
  if (acc >= 0.9 && hardLeft < 6 && median <= s.clock * 0.6) c = Math.max(MIN_CLOCK, s.clock - 1);
  else if (acc < 0.7) c = Math.min(MAX_CLOCK, s.clock + 1);
  if (c === s.clock) return null;
  s.clock = c;
  return c;
}

export function mastery(f) {
  if (!f || !(f.seen > 0)) return 'untried';
  const h = f.history ?? [], last = h.at(-1);
  if (!last) return f.box >= 3 ? 'automatic' : f.box >= 1 ? 'good' : 'practice';
  if (!last.ok) return 'practice';
  const fast = x => x.ok && x.secs <= FAST_SECS;
  if (h.length >= 2 && fast(h.at(-1)) && fast(h.at(-2))) return 'automatic';
  return fast(last) ? 'good' : 'learning';
}

export function strength(op, s, mem, g) {
  const ps = g.keys.map(k => findItem(op, k)).filter(Boolean).map(it => pCorrect(s, mem[it.key], it));
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
}
export const masteredGroups = (op, mem) =>
  new Set(groups(op).filter(g => g.keys.every(k => ['automatic', 'good'].includes(mastery(mem[k])))).map(g => g.milestone));

export const speedPoints = (elapsed, clock) => 5 + Math.ceil(10 * Math.max(0, clock - elapsed) / clock);
