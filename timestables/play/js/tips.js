// Kid-friendly tricks, said out loud after a miss. A port of the app's Tips.swift.
export function tipFor(q) {
  switch (q.op) {
    case 'mul': return times(q.a, q.b);
    case 'div': return division(q.a, q.b);
    case 'add': return addition(q.a, q.b);
    default: return subtraction(q.a, q.b);
  }
}

function times(a, b) {
  const x = Math.min(a, b), y = Math.max(a, b);
  const famous = {
    '7,8': 'Remember five, six, seven, eight: 56 is 7 times 8!',
    '8,8': 'Here\'s a rhyme: I ate and I ate till I was sick on the floor, 8 times 8 is 64!',
    '6,8': '6 and 8 went on a date, and came back 48!',
    '7,7': '7 times 7 is 49. Picture two lucky sevens!',
    '11,11': '11 times 11 is 121. It reads the same both ways!',
    '12,12': '12 times 12 is a gross, 144. 10 twelves is 120, plus 2 twelves is 24.',
  }[`${x},${y}`];
  if (famous) return famous;
  for (const f of [0, 1, 10, 11, 2, 5, 9, 4, 3, 6, 8, 12, 7]) {
    if (a !== f && b !== f) continue;
    const n = a === f ? b : a, t = trick(f, n);
    if (t) return t;
  }
  return null;
}

function trick(f, n) {
  switch (f) {
    case 0: return 'Anything times zero is zero.';
    case 1: return `Anything times 1 stays the same: ${n}.`;
    case 10: return `Times 10? Just put a zero on the end. ${n} becomes ${n * 10}.`;
    case 11:
      if (n <= 9) return `Elevens trick: 11 times ${n} is just two ${n}s side by side, ${n * 11}.`;
      if (n === 10) return '11 times 10: put a zero on 11, and you get 110.';
      if (n === 12) return '11 times 12: 10 twelves is 120, plus one more 12 is 132.';
      return null;
    case 2: return `Times 2 means double it: ${n} plus ${n} is ${n * 2}.`;
    case 5: return `Fives trick: ${n} times 10 is ${n * 10}, and half of that is ${n * 5}.`;
    case 9:
      if (n <= 10) return `Nines trick: take one away from ${n} to get ${n - 1}. Then ${n - 1} plus what makes 9? ${10 - n}. So it's ${n * 9}.`;
      return `Nines trick: 10 times ${n} is ${n * 10}, take away one ${n}, and you get ${n * 9}.`;
    case 4: return `Fours trick: double it, then double again. ${n}, ${n * 2}, ${n * 4}.`;
    case 3: return `Threes trick: double ${n} to get ${n * 2}, then add one more ${n}. That's ${n * 3}.`;
    case 6: return `Sixes trick: 5 times ${n} is ${n * 5}, plus one more ${n} makes ${n * 6}.`;
    case 8: return `Eights trick: double it three times. ${n}, ${n * 2}, ${n * 4}, ${n * 8}.`;
    case 12: return `Twelves trick: 10 times ${n} is ${n * 10}, plus 2 times ${n} is ${n * 2}. Together that's ${n * 12}.`;
    case 7: return `Sevens trick: 5 times ${n} is ${n * 5}, plus 2 times ${n} is ${n * 2}. Together that's ${n * 7}.`;
  }
  return null;
}

function division(m, d) {
  const q = m / d;
  if (d === 1) return `Dividing by 1 changes nothing: ${m}.`;
  if (d === m) return 'Any number divided by itself is 1.';
  if (d === 10) return `Dividing by 10? Just take the zero off the end. ${m} becomes ${q}.`;
  return `Think backwards: ${d} times what makes ${m}? ${d} times ${q} is ${m}, so the answer is ${q}.`;
}

function addition(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b), sum = a + b;
  if (hi >= 10 && lo >= 10) {
    const tens = Math.floor(lo / 10) * 10, ones = lo % 10;
    if (ones === 0) return `Add the tens: ${hi} plus ${tens} is ${sum}.`;
    return `Tens first: ${hi} plus ${tens} is ${hi + tens}. Then plus ${ones} is ${sum}.`;
  }
  if (hi > 10) {
    const nextTen = (Math.floor(hi / 10) + 1) * 10, need = nextTen - hi;
    if (hi % 10 + lo < 10) return `Add the ones: ${hi % 10} plus ${lo} is ${hi % 10 + lo}, so ${hi} plus ${lo} is ${sum}.`;
    return `Make the next ten: ${hi} plus ${need} is ${nextTen}. Then ${lo - need} more makes ${sum}.`;
  }
  if (lo === 1) return `Plus 1 is just the next number: ${sum}.`;
  if (hi === 10) return `Plus 10 is easy: ${lo} and 10 make ${sum}.`;
  if (lo === hi) return `Doubles: ${lo} plus ${lo} is ${sum}.`;
  if (hi - lo === 1) return `Near doubles: ${lo} plus ${lo} is ${lo * 2}, and one more makes ${sum}.`;
  if (hi === 9) return `Nines trick: ${lo} plus 10 is ${lo + 10}. Take one away, and it's ${sum}.`;
  if (sum > 10) { const need = 10 - hi; return `Make a ten: take ${need} from the ${lo} to turn ${hi} into 10. Then ${lo - need} more makes ${sum}.`; }
  return `Start at ${hi} and count up ${lo}: ${sum}.`;
}

function subtraction(m, b) {
  const c = m - b;
  if (b >= 10 && m > 20) {
    const tens = Math.floor(b / 10) * 10, ones = b % 10;
    if (ones === 0) return `Take away the tens: ${m} minus ${tens} is ${c}.`;
    return `Tens first: ${m} minus ${tens} is ${m - tens}. Then minus ${ones} is ${c}.`;
  }
  if (m > 20) {
    const down = m % 10;
    if (down >= b) return `Take from the ones: ${down} minus ${b} is ${down - b}, so it's ${c}.`;
    return `Down to a ten: ${m} minus ${down} is ${m - down}. Then ${b - down} more takes you to ${c}.`;
  }
  if (b === 1) return `Minus 1 is just the number before: ${c}.`;
  if (b === 10) return `Minus 10: ${m} take away 10 leaves ${c}.`;
  if (b === c) return `Doubles help: ${b} plus ${b} is ${m}, so ${m} minus ${b} is ${b}.`;
  if (b === 9 && m > 10) return `Minus 9 trick: take away 10 to get ${m - 10}, then add one back: ${c}.`;
  if (m > 10 && b > m - 10) return `Down to ten: ${m} minus ${m - 10} is 10. Then take ${b - (m - 10)} more to get ${c}.`;
  return `Think addition: ${b} plus what makes ${m}? ${c}.`;
}
