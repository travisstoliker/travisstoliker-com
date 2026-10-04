// The four kinds of practice, the facts in each, and how hard each usually is.
// A straight port of the iPhone app's Modes.swift, so both play the same.

export const OPS = ['mul', 'div', 'add', 'sub'];
export const OP = {
  mul: { symbol: '×', word: 'times', label: '× Times', noun: 'multiplication', max: 144, commutative: true },
  div: { symbol: '÷', word: 'divided by', label: '÷ Divide', noun: 'division', max: 12, commutative: false },
  add: { symbol: '+', word: 'plus', label: '+ Plus', noun: 'addition', max: 99, commutative: true },
  sub: { symbol: '−', word: 'minus', label: '− Minus', noun: 'subtraction', max: 99, commutative: false },
};
// Same save keys as the app: multiplication keeps the original ones.
export const storeKey = (op, base) => (op === 'mul' ? base : `${base}.${op}`);
// Dates are seconds since 2001-01-01, as the iPhone app saves them, so data moves between them.
export const nowRef = () => Date.now() / 1000 - 978307200;
export const factKey = (a, b) => (a <= b ? `${a}x${b}` : `${b}x${a}`);

export const KIND = {
  add21: 'add:2d+1d', add21c: 'add:2d+1d:carry', add22: 'add:2d+2d', add22c: 'add:2d+2d:carry',
  sub21: 'sub:2d-1d', sub21b: 'sub:2d-1d:borrow', sub22: 'sub:2d-2d', sub22b: 'sub:2d-2d:borrow',
};
export const KIND_NAME = {
  [KIND.add21]: '2-digit + 1-digit', [KIND.add21c]: '2-digit + 1-digit, carrying',
  [KIND.add22]: '2-digit + 2-digit', [KIND.add22c]: '2-digit + 2-digit, carrying',
  [KIND.sub21]: '2-digit − 1-digit', [KIND.sub21b]: '2-digit − 1-digit, borrowing',
  [KIND.sub22]: '2-digit − 2-digit', [KIND.sub22b]: '2-digit − 2-digit, borrowing',
};

export function question(op, a, b, key) {
  const o = OP[op];
  const answer = op === 'mul' ? a * b : op === 'div' ? a / b : op === 'add' ? a + b : a - b;
  const scale = [KIND.add21, KIND.add21c, KIND.sub21, KIND.sub21b].includes(key) ? 1.3
    : [KIND.add22, KIND.add22c, KIND.sub22, KIND.sub22b].includes(key) ? 1.6 : 1;
  return {
    op, a, b, key, answer, clockScale: scale,
    text: `${a} ${o.symbol} ${b}`, full: `${a} ${o.symbol} ${b} = ${answer}`,
    spoken: `${a} ${o.word} ${b}`, factLine: `${a} ${o.word} ${b} is ${answer}.`,
  };
}

const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** A question for an item: facts are fixed, kinds of bigger problems get new numbers. */
export function ask(it) {
  if (!it.isKind) {
    const swap = OP[it.op].commutative && Math.random() < 0.5;
    return question(it.op, swap ? it.b : it.a, swap ? it.a : it.b, it.key);
  }
  let x = 0, y = 0;
  for (let i = 0; i < 200; i++) {
    const k = it.key;
    if (k === KIND.add21 || k === KIND.add21c) {
      x = rnd(11, 89); y = rnd(2, 9);
      if ((x % 10 + y >= 10) === (k === KIND.add21c) && x % 10 !== 0) break;
    } else if (k === KIND.add22 || k === KIND.add22c) {
      x = rnd(11, 79); y = rnd(11, 99 - x);
      if (y >= 11 && (x % 10 + y % 10 >= 10) === (k === KIND.add22c)) break;
    } else if (k === KIND.sub21 || k === KIND.sub21b) {
      x = rnd(12, 99); y = rnd(2, 9);
      if ((x % 10 < y) === (k === KIND.sub21b) && x - y >= 10) break;
    } else {
      x = rnd(30, 99); y = rnd(11, x - 10);
      if ((x % 10 < y % 10) === (k === KIND.sub22b)) break;
    }
  }
  const swap = it.op === 'add' && Math.random() < 0.5;
  return question(it.op, swap ? y : x, swap ? x : y, it.key);
}

export const logit = p => Math.log(p / (1 - p));
export const sigmoid = x => 1 / (1 + Math.exp(-x));

function mulEase(t, other) {
  return ({ 1: 0.97, 10: 0.92, 2: 0.9, 5: 0.85, 3: 0.75, 4: 0.74, 9: 0.66, 6: 0.62, 8: 0.56, 7: 0.55 })[t]
    ?? (t === 11 ? (other <= 10 ? 0.85 : 0.55) : 0.52);
}
export function mulPrior(a, b) {
  let p = Math.max(mulEase(a, b), mulEase(b, a));
  if (a === b) p += 0.05;
  return Math.min(0.97, p);
}
function addPrior(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo === 1) return 0.97; if (hi === 10) return 0.95; if (lo === 2) return 0.92; if (lo === hi) return 0.9;
  if (a + b <= 10) return 0.88; if (hi - lo === 1) return 0.8; if (hi === 9) return 0.76; return 0.7;
}
function subPrior(m, b) {
  const c = m - b;
  if (b === 1 || c === 1) return 0.95; if (b === 10 || c === 10) return 0.9; if (m <= 10) return 0.86;
  if (b === c) return 0.82; if (b === 9) return 0.72; return 0.62;
}

const item = (op, key, a, b, tags, prior, penalty = 0, isKind = false) => ({ op, key, a, b, tags, prior, penalty, isKind });
export const ITEMS = { mul: [], div: [], add: [], sub: [] };
for (let a = 1; a <= 12; a++) for (let b = a; b <= 12; b++)
  ITEMS.mul.push(item('mul', factKey(a, b), a, b, [String(a), String(b)], mulPrior(a, b), a === 1 || b === 1 ? 2.5 : 0));
for (let d = 1; d <= 12; d++) for (let q = 1; q <= 12; q++)
  ITEMS.div.push(item('div', `${d * q}/${d}`, d * q, d, [String(d), String(q)], sigmoid(logit(mulPrior(d, q)) - 0.4), d === 1 ? 2.5 : q === 1 ? 1 : 0));
for (let a = 1; a <= 10; a++) for (let b = a; b <= 10; b++)
  ITEMS.add.push(item('add', `${a}+${b}`, a, b, [String(a), String(b)], addPrior(a, b), a === 1 ? 1 : 0));
for (const [k, p] of [[KIND.add21, 0.72], [KIND.add21c, 0.58], [KIND.add22, 0.6], [KIND.add22c, 0.45]]) ITEMS.add.push(item('add', k, 0, 0, [k], p, 0, true));
for (let b = 1; b <= 10; b++) for (let c = 1; c <= 10; c++)
  ITEMS.sub.push(item('sub', `${b + c}-${b}`, b + c, b, [String(b), String(c)], subPrior(b + c, b), b === 1 ? 1 : c === 1 ? 0.6 : 0));
for (const [k, p] of [[KIND.sub21, 0.7], [KIND.sub21b, 0.5], [KIND.sub22, 0.55], [KIND.sub22b, 0.4]]) ITEMS.sub.push(item('sub', k, 0, 0, [k], p, 0, true));

const INDEX = Object.fromEntries(OPS.map(op => [op, new Map(ITEMS[op].map(i => [i.key, i]))]));
export const findItem = (op, key) => INDEX[op].get(key);

/** Groups of facts to master ("the 7s", "dividing by 7"), for milestones and summaries. */
export function groups(op) {
  const r = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  switch (op) {
    case 'mul': return r(2, 12).map(n => ({ label: `${n}`, milestone: `the ${n}s`, keys: r(2, 12).map(k => factKey(n, k)) }));
    case 'div': return r(2, 12).map(n => ({ label: `÷${n}`, milestone: `dividing by ${n}`, keys: r(1, 12).map(k => `${n * k}/${n}`) }));
    case 'add': return r(2, 10).map(n => ({ label: `+${n}`, milestone: `adding ${n}`, keys: r(1, 10).map(k => `${Math.min(n, k)}+${Math.max(n, k)}`) }));
    default: return r(2, 10).map(n => ({ label: `−${n}`, milestone: `taking away ${n}`, keys: r(1, 10).map(k => `${n + k}-${n}`) }));
  }
}
