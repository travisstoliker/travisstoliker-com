// Talking and listening. Both are optional: the grown-up can always tap.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;

let voice = null;
function pickVoice() {
  if (!canSpeak) return;
  const vs = speechSynthesis.getVoices().filter(v => /^en(-|_)/i.test(v.lang));
  voice = vs.find(v => /samantha|ava|allison|google us english/i.test(v.name))
    || vs.find(v => /en-US/i.test(v.lang)) || vs[0] || null;
}
if (canSpeak) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

// Say a word or sentence. Must be called from a tap on iPhone.
export function say(text, rate = 0.8) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = rate;
  speechSynthesis.speak(u);
}

// Words that sound the same, so the mic doesn't mark them wrong.
const SAME = {
  mat: ['matt'], sam: ['psalm'], sun: ['son'], red: ['read'], see: ['sea', 'c'],
  week: ['weak'], to: ['too', 'two'], i: ['eye'], be: ['bee', 'b'], him: ['hymn'],
  not: ['knot'], tam: ['tom'], ten: ['10'], six: ['6'], seven: ['7'], we: ['wee'],
  mom: ['mum'], yak: ['yack'],
  fur: ['fir'], dear: ['deer'], mitt: ['mit'], rap: ['wrap'], ring: ['wring'],
};
const norm = s => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
const ok = (heard, want) => heard === want || (SAME[want] || []).includes(heard);

// Does what was heard contain these words in order?
export function matches(heardText, wantText) {
  const h = norm(heardText), w = norm(wantText);
  let j = 0;
  for (const x of h) if (j < w.length && ok(x, w[j])) j++;
  return j === w.length;
}

// Listen once. Resolves with a list of things it might have heard ([] if nothing).
export function listen(seconds = 6) {
  return new Promise(resolve => {
    if (!SR) return resolve([]);
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 5;
    let got = [];
    const stop = setTimeout(() => { try { r.stop(); } catch {} }, seconds * 1000);
    r.onresult = e => {
      for (const res of e.results) for (const alt of res) got.push(alt.transcript);
    };
    r.onerror = () => {};
    r.onend = () => { clearTimeout(stop); resolve(got); };
    try { r.start(); } catch { clearTimeout(stop); resolve([]); }
  });
}

// Say something and wait until it's finished (with a safety timeout).
export function speak(text, rate = 0.95) {
  return new Promise(resolve => {
    if (!canSpeak) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = rate;
    let done = false;
    const end = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
    const t = setTimeout(end, 2500 + text.length * 90);
    u.onend = end; u.onerror = end;
    speechSynthesis.speak(u);
  });
}

// Spoken commands from the grown-up (or the child).
export function command(heardList) {
  const words = heardList.join(' ').toLowerCase();
  const has = re => re.test(words);
  if (has(/\b(stop|pause|quit)\b/)) return 'stop';
  if (has(/\b(repeat|say that again|what)\b/)) return 'repeat';
  if (has(/\bskip\b/)) return 'skip';
  if (has(/\b(again|try again|wrong|nope|not quite)\b/) || /^\s*no\b/.test(words)) return 'no';
  if (has(/\b(yes|yeah|yep|right|correct|good|got it)\b/)) return 'yes';
  return null;
}
