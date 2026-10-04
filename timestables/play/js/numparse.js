// Turns what the speech recognizer heard ("fifty six", "56", "it's forty-two") into a
// number, and spots spoken commands. A port of the app's NumberParser.swift.
const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SOUNDALIKES = { to: 2, too: 2, tu: 2, for: 4, fore: 4, ate: 8, won: 1, sex: 6, tree: 3, free: 3, nein: 9, tin: 10, fine: 5, sticks: 6 };

export const tokenize = text => text.toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/-/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);

function scan(tokens, units) {
  const out = []; let cur = null, last = null;
  const flush = () => { if (cur !== null) out.push(cur); cur = null; last = null; };
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (cur !== null && last === 'digits' && cur < 10 && t.length === 2) cur = cur * 100 + n; else { flush(); cur = n; }
      last = 'digits';
    } else if (t in TENS) {
      const tv = TENS[t];
      if (cur !== null && last === 'hundred') cur += tv;
      else if (cur !== null && last === 'unit' && cur > 0 && cur < 10) cur = cur * 100 + tv;
      else { flush(); cur = tv; }
      last = 'tens';
    } else if (t in units) {
      const u = units[t];
      if (cur !== null && last === 'tens' && u < 10) cur += u;
      else if (cur !== null && last === 'hundred') cur += u;
      else { flush(); cur = u; }
      last = 'unit';
    } else if (t === 'hundred') { cur = (cur ?? 1) * 100; last = 'hundred'; }
    else if (t === 'and') continue;
    else flush();
  }
  flush();
  return out;
}

export function allNumbers(text) {
  const t = tokenize(text), strict = scan(t, UNITS);
  return strict.length ? strict : scan(t, { ...SOUNDALIKES, ...UNITS });
}
export const parse = text => allNumbers(text).at(-1) ?? null;

/** Read an answer knowing the right one, undoing common mishearings ("1616" for 16, "184" for 84). */
export function interpret(text, expect, max = 144) {
  const n = parse(text);
  if (n === null || expect === null || expect === undefined || n === expect) return n;
  const ns = String(n), es = String(expect);
  if (ns.length > es.length && ns.length % es.length === 0 && es.repeat(ns.length / es.length) === ns && (max >= 100 || n > max)) return expect;
  if (n > max && ns.endsWith(es)) return expect;
  return n;
}

export function soundsUnfinished(text, n, expect) {
  const words = tokenize(text), last = words.at(-1);
  if (['and', 'hundred', 'a', 'um', 'uh'].includes(last)) return true;
  if (expect === null || expect === n) return false;
  if (n % 10 === 0 && n >= 20 && n <= 90 && expect > n && expect < n + 10) return true;
  if (n === 100 && expect > 100 && expect <= 144) return true;
  if (n >= 1 && n <= 9 && expect >= 100 && Math.floor(expect / 100) === n) return true;
  return false;
}

export function command(text) {
  const t = ' ' + tokenize(text).join(' ') + ' ';
  if (t.includes(' play again ')) return null;
  const has = ws => ws.some(w => t.includes(` ${w} `));
  if (has(['repeat', 'again', 'huh', 'say that again', 'what was it'])) return 'repeat';
  if (has(['skip', 'pass', 'next'])) return 'skip';
  if (has(['pause', 'stop'])) return 'pause';
  return null;
}
