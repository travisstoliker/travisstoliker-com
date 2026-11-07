import { LESSONS, SOUNDS, TRICKY, units, soundOf, slow, taughtBy, wordsIn } from './lessons.js';
import { say, speak, listen, matches, command, canListen, canSpeak } from './speech.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- saved progress (this device only) ----------
const KEY = 'di-reading.v1';
let S = { kids: [], current: null, mic: false };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const kid = () => S.kids.find(k => k.id === S.current) || null;

// ---------- screens ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
  window.scrollTo(0, 0);
}

// ---------- home ----------
function renderHome() {
  const k = kid();
  const kids = $('#kids');
  kids.innerHTML = S.kids.map(x =>
    `<button class="chip ${x.id === S.current ? 'on' : ''}" data-id="${x.id}">${esc(x.name)}</button>`).join('')
    + `<button class="chip add" id="btnAddKid">+ Add a reader</button>`;
  kids.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { S.current = b.dataset.id; save(); renderHome(); });
  $('#btnAddKid').onclick = addKid;

  const start = $('#btnStart');
  const grid = $('#grid');
  if (!k) {
    start.hidden = true;
    $('#btnCar').hidden = true;
    grid.innerHTML = '';
    $('#gridWrap').hidden = true;
    return;
  }
  $('#gridWrap').hidden = false;
  start.hidden = false;
  const n = Math.min(k.lesson, LESSONS.length - 1);
  start.innerHTML = `▶ Start lesson ${n + 1}<small>${esc(k.name)} · about 5 minutes</small>`;
  start.onclick = () => startLesson(n);
  const car = $('#btnCar');
  car.hidden = !(canListen && canSpeak);
  car.innerHTML = `🚗 Lesson ${n + 1} in the car<small>The app talks. You just say “yes” or “again”.</small>`;
  car.onclick = () => startLesson(n, true);
  grid.innerHTML = LESSONS.map((L, i) => {
    const d = k.done?.[i];
    const label = L.new ? L.new : '★';
    return `<button class="cell ${d ? 'done' : ''} ${i === n ? 'next' : ''}" data-i="${i}" aria-label="Lesson ${i + 1}">
      <b>${i + 1}</b><span class="lt">${esc(label)}</span>${d ? '<i>✓</i>' : ''}</button>`;
  }).join('');
  grid.querySelectorAll('.cell').forEach(c => c.onclick = () => startLesson(+c.dataset.i));
}

function addKid() {
  const f = $('#addForm');
  f.hidden = false;
  $('#kidName').value = '';
  $('#kidName').focus();
}
$('#addForm').onsubmit = e => {
  e.preventDefault();
  const name = $('#kidName').value.trim().slice(0, 20);
  $('#addForm').hidden = true;
  if (!name) return;
  const k = { id: Math.random().toString(36).slice(2, 9), name, lesson: 0, done: {} };
  S.kids.push(k);
  S.current = k.id;
  save();
  renderHome();
};
$('#addCancel').onclick = () => { $('#addForm').hidden = true; };

// ---------- building a lesson ----------
function pickReview(i, count) {
  // Earlier sounds, newest ones more often, never the same twice in a row.
  const past = LESSONS.slice(0, i).map(L => L.new).filter(Boolean);
  const recent = past.slice(-4), older = past.slice(0, -4);
  const pool = [...recent, ...recent, ...older.sort(() => Math.random() - .5).slice(0, 4)];
  const out = [];
  for (const u of pool.sort(() => Math.random() - .5)) {
    if (out.length >= count) break;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

const shuffle = a => [...a].sort(() => Math.random() - .5);

// Four words, mostly ones with today's new sound. Different words each time a lesson is repeated.
function pickWords(L) {
  const has = w => L.new && units(w).some(u => soundOf(u) === L.new);
  const withNew = shuffle(L.read.filter(has)), rest = shuffle(L.read.filter(w => !has(w)));
  return [...withNew.slice(0, 3), ...rest, ...withNew.slice(3)].slice(0, 4);
}

function buildLesson(i) {
  const L = LESSONS[i];
  const parts = [];
  if (L.new || L.tricky) {
    const items = [];
    if (L.new) items.push({ t: 'new', u: L.new });
    (L.tricky || []).forEach(w => items.push({ t: 'tricky', w }));
    parts.push({ title: 'New today', items });
  }
  const review = pickReview(i, 3).map(u => ({ t: 'sound', u }));
  if (L.new) review.push({ t: 'sound', u: L.new });
  if (review.length) parts.push({ title: 'Sounds', items: review });
  parts.push({ title: 'Say it fast', items: shuffle(L.hear).slice(0, 2).map(w => ({ t: 'hear', w })) });
  if (L.read.length) parts.push({ title: 'Read the words', items: pickWords(L).map(w => ({ t: 'word', w })) });
  if (L.story?.length) {
    parts.push({ title: 'Read the story', items: L.story.map(s => ({ t: 'story', s })) });
    if (L.q) parts.push({ title: 'Talk about it', items: [{ t: 'q', q: L.q }] });
  }
  return parts;
}

// ---------- running a lesson ----------
let R = null; // the lesson in progress

function startLesson(i, car = false) {
  if (!kid()) return addKid();
  if (R) R.token = -1;
  const parts = buildLesson(i);
  R = { car, token: 0, told: false, i, parts, p: 0, queue: [...parts[0].items], firstTry: 0, total: 0, missed: new Set(), sub: null };
  R.total = parts.reduce((n, p) => n + p.items.filter(x => x.t !== 'q').length, 0);
  show('lesson');
  $('#lessonTitle').textContent = `${car ? '🚗 ' : ''}Lesson ${i + 1}`;
  document.body.classList.toggle('car', car);
  if (car) { keepAwake(); speechSynthesis?.cancel(); }
  step();
}

function progress() {
  const doneParts = R.parts.slice(0, R.p).reduce((n, p) => n + p.items.length, 0);
  const all = R.parts.reduce((n, p) => n + p.items.length, 0);
  const inPart = R.parts[R.p].items.length - Math.min(R.queue.length, R.parts[R.p].items.length);
  $('#bar').style.width = `${Math.round(100 * (doneParts + inPart) / all)}%`;
  $('#partName').textContent = `${R.parts[R.p].title} · part ${R.p + 1} of ${R.parts.length}`;
}

function next(firstTryRight) {
  const item = R.queue.shift();
  if (firstTryRight && !R.missed.has(item)) R.firstTry++;
  if (!R.queue.length) {
    R.p++;
    if (R.p >= R.parts.length) return finish();
    R.queue = [...R.parts[R.p].items];
  }
  step();
}

// Missed: fix it now, then it comes back at the end of this part (firm-up).
function missed(item) {
  R.missed.add(item);
  R.queue.push(item);
}

const kidCard = $('#kidCard'), script = $('#script'), btns = $('#btns'), heard = $('#heard');

function setButtons(list) {
  btns.innerHTML = '';
  for (const [label, cls, fn] of list) {
    const b = document.createElement('button');
    b.className = cls; b.innerHTML = label; b.onclick = fn;
    btns.appendChild(b);
  }
}

const you = t => `<p class="you"><span>You say</span>${t}</p>`;
const they = t => `<p class="they"><span>${esc(kid()?.name || 'Child')} says</span>${t}</p>`;
const note = t => `<p class="note">${t}</p>`;
const snd = u => `<b class="snd">${esc(SOUNDS[soundOf(u)].say)}</b>`;
const holdNote = u => SOUNDS[soundOf(u)].hold ? 'Hold it for about two seconds.' : 'Say it quick. No "uh" on the end.';

function letters(word, { dots = true, lit = -1 } = {}) {
  const us = units(word);
  return `<div class="word ${dots ? 'dotted' : ''}">` + us.map((u, k) =>
    `<span class="u ${k <= lit ? 'lit' : ''}" data-k="${k}">${esc(u)}${dots ? '<i class="dot"></i>' : ''}</span>`).join('')
    + (dots ? '<i class="arrow"></i>' : '') + '</div>';
}

function step() {
  progress();
  heard.textContent = '';
  const item = R.queue[0];
  R.sub = null;
  ({ new: stepNew, tricky: stepTricky, sound: stepSound, hear: stepHear, word: stepWord, story: stepStory, q: stepQ })[item.t](item);
  if (R.car) carRun(item, false);
}

const right = () => next(true);
const okWrong = (item, fix) => [
  ['✓ Right', 'yes', right],
  ['✗ Not yet', 'no', () => fix(item)],
];

// --- new sound
function stepNew(item) {
  const u = item.u;
  kidCard.innerHTML = `<div class="big">${esc(u)}</div>`;
  script.innerHTML =
    note(`New sound. Point just under the letter.`) +
    you(`“Here's a new sound. My turn: ${snd(u)}.”`) + note(holdNote(u) + ` (It's the first sound in “${SOUNDS[u].as}”.)`) +
    you(`“Say it with me: ${snd(u)}.”`) + you(`“Your turn. What sound?”`) + they(snd(u));
  setButtons(okWrong(item, fixSound));
}

// --- tricky word
function stepTricky(item) {
  const w = item.w;
  kidCard.innerHTML = `<div class="big">${esc(w === 'i' ? 'I' : w)}</div><div class="tag">tricky word</div>`;
  script.innerHTML =
    note(`A tricky word. It doesn't sound out the usual way yet. ${esc(TRICKY[w])}`) +
    you(`“This word is <b>${esc(w === 'i' ? 'I' : w)}</b>. What word?”`) + they(`<b>${esc(w === 'i' ? 'I' : w)}</b>`);
  setButtons([...okWrong(item, fixTricky), ...(canSpeak ? [['🔊 Hear it', 'ghost', () => say(w === 'i' ? 'I' : w)]] : [])]);
  micButton(w === 'i' ? 'I' : w);
}

// --- sound review
function stepSound(item) {
  const u = item.u;
  kidCard.innerHTML = `<div class="big">${esc(u)}</div>`;
  script.innerHTML = note('Point just under the letter.') + you('“What sound?”') + they(snd(u)) + note(holdNote(u));
  setButtons(okWrong(item, fixSound));
}

function fixSound(item) {
  const u = item.u;
  missed(item);
  script.innerHTML = note('<b>Fix it right away, kindly.</b>') +
    you(`“My turn: ${snd(u)}.”`) + you(`“Say it with me: ${snd(u)}.”`) + you(`“Your turn. What sound?”`) + they(snd(u)) +
    note('It comes back again at the end of this part.');
  setButtons([['Next ▶', 'yes', () => { R.queue.shift(); R.queue.length ? step() : next(false); }]]);
  if (R.car) carRun(item, true);
}

function fixTricky(item) {
  const w = item.w === 'i' ? 'I' : item.w;
  missed(item);
  script.innerHTML = note('<b>Fix it right away, kindly.</b>') +
    you(`“This word is <b>${esc(w)}</b>. What word?”`) + they(`<b>${esc(w)}</b>`) +
    note('It comes back again at the end of this part.');
  setButtons([['Next ▶', 'yes', () => { R.queue.shift(); R.queue.length ? step() : next(false); }],
    ...(canSpeak ? [['🔊 Hear it', 'ghost', () => say(w)]] : [])]);
  if (R.car) carRun(item, true);
}

// --- say it slow, say it fast (listening only, nothing to read)
function stepHear(item) {
  const w = item.w;
  kidCard.innerHTML = `<div class="ear">👂</div><div class="tag">Listen. No reading yet.</div>`;
  script.innerHTML =
    you(`“Listen. I'll say it slow: <b class="snd">${esc(slow(w))}</b>.”`) +
    note('Don\'t stop between the sounds. Slide from one to the next.') +
    you('“Say it fast!”') + they(`<b>${esc(w)}</b>`);
  setButtons(okWrong(item, fixHear));
  micButton(w);
}

function fixHear(item) {
  const w = item.w;
  missed(item);
  script.innerHTML = note('<b>Fix it right away, kindly.</b>') +
    you(`“My turn. <b class="snd">${esc(slow(w))}</b>. Say it fast: <b>${esc(w)}</b>.”`) +
    you(`“Your turn. Listen: <b class="snd">${esc(slow(w))}</b>. Say it fast!”`) + they(`<b>${esc(w)}</b>`) +
    note('It comes back again at the end of this part.');
  setButtons([['Next ▶', 'yes', () => { R.queue.shift(); R.queue.length ? step() : next(false); }],
    ...(canSpeak ? [['🔊 Hear it', 'ghost', () => say(w)]] : [])]);
  if (R.car) carRun(item, true);
}

// --- sound out a word, then say it fast
function stepWord(item) {
  const w = item.w;
  const us = units(w);
  let lit = -1;
  const draw = () => {
    kidCard.innerHTML = letters(w, { lit }) +
      `<div class="tag">${lit < us.length - 1 ? 'Touch each dot and say each sound.' : 'Now say it fast!'}</div>`;
    const word = kidCard.querySelector('.word');
    const touch = e => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.u');
      if (!el) return;
      const k = +el.dataset.k;
      if (k === lit + 1) { lit = k; draw(); }
    };
    word.addEventListener('pointerdown', e => { try { word.setPointerCapture(e.pointerId); } catch {} touch(e); });
    word.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') touch(e); });
  };
  draw();
  script.innerHTML =
    you('“Touch under each sound. Say the sounds. Don\'t stop between them.”') +
    they(`<b class="snd">${esc(slow(w))}</b>`) +
    you('“Say it fast!”') + they(`<b>${esc(w)}</b>`) +
    note('If they stop between sounds or skip one, tap ✗ Not yet.');
  setButtons(okWrong(item, fixWord));
  micButton(w);
}

function fixWord(item) {
  const w = item.w;
  missed(item);
  kidCard.innerHTML = letters(w, { lit: units(w).length - 1 });
  script.innerHTML = note('<b>Fix it right away, kindly.</b>') +
    you(`“My turn. I'll touch the sounds: <b class="snd">${esc(slow(w))}</b>. Say it fast: <b>${esc(w)}</b>.”`) +
    you(`“Do it with me: <b class="snd">${esc(slow(w))}</b>.”`) +
    you('“Your turn. Sound it out, then say it fast.”') + they(`<b>${esc(w)}</b>`) +
    note('It comes back again at the end of this part.');
  setButtons([['Next ▶', 'yes', () => { R.queue.shift(); R.queue.length ? step() : next(false); }],
    ...(canSpeak ? [['🔊 Hear it', 'ghost', () => say(w)]] : [])]);
  if (R.car) carRun(item, true);
}

// --- story: word by word, then the whole sentence fast
function stepStory(item) {
  const s = item.s;
  const parts = s.split(/(\s+)/);
  const ws = wordsIn(s);
  let at = item.at || 0;
  const draw = () => {
    let wi = -1;
    kidCard.innerHTML = '<p class="story">' + parts.map(p => {
      if (/^\s+$/.test(p)) return ' ';
      wi++;
      return `<span class="sw ${wi === at ? 'cur' : wi < at ? 'read' : ''}">${esc(p)}</span>`;
    }).join('') + '</p>';
  };
  const { tricky } = taughtBy(R.i);
  const wordStep = () => {
    draw();
    const w = ws[at];
    const isTricky = tricky.has(w);
    script.innerHTML =
      note(`Word ${at + 1} of ${ws.length}. Point under it.`) +
      (isTricky ? you('“What word?”') : you('“Sound it out. Then say it fast.”')) +
      they(`<b>${esc(w === 'i' ? 'I' : w)}</b>`);
    setButtons([
      ['✓ Right', 'yes', () => { at++; at < ws.length ? wordStep() : fastStep(); }],
      ['✗ Not yet', 'no', () => {
        R.missed.add(item);
        script.innerHTML = note('<b>Fix it, then go back to the start of the sentence.</b>') +
          you(`“That word is <b>${esc(w === 'i' ? 'I' : w)}</b>. ${isTricky ? '' : `Sound it out with me: <b class="snd">${esc(slow(w))}</b>. `}What word?”`) +
          they(`<b>${esc(w === 'i' ? 'I' : w)}</b>`) + you('“Let\'s start the sentence again.”');
        setButtons([['Start again ▶', 'yes', () => { at = 0; wordStep(); }],
          ...(canSpeak ? [['🔊 Hear it', 'ghost', () => say(w === 'i' ? 'I' : w)]] : [])]);
      }],
    ]);
    heard.textContent = '';
  };
  const fastStep = () => {
    at = ws.length;
    draw();
    script.innerHTML = you('“Good reading. Now read it again, the fast way.”') + they(`<b>${esc(s.replace(/^./, c => c.toUpperCase()))}</b>`);
    setButtons([
      ['✓ Right', 'yes', right],
      ['Read it again', 'ghost', () => { at = 0; wordStep(); }],
    ]);
    micButton(s);
  };
  wordStep();
}

// --- question about the story
function stepQ(item) {
  const [q, a] = item.q;
  const L = LESSONS[R.i];
  kidCard.innerHTML = '<div class="story-all">' + L.story.map(s => `<p class="story">${esc(s)}</p>`).join('') + '</div>';
  script.innerHTML = you(`“${esc(q)}”`) + they(esc(a)) + note('Any answer that shows they understood is right. Let them look back at the story.');
  setButtons([['✓ Done', 'yes', () => next(false)]]);
}

// --- optional mic check: it only ever marks right, never wrong
function micButton(want) {
  if (!S.mic || !canListen) return;
  const b = document.createElement('button');
  b.className = 'ghost';
  b.textContent = '🎤 Check with the mic';
  b.onclick = async () => {
    b.disabled = true; b.textContent = '🎤 Listening…';
    const got = await listen(5);
    b.disabled = false; b.textContent = '🎤 Check with the mic';
    if (got.some(g => matches(g, want))) {
      heard.textContent = `🎤 Heard “${got[0]}”. Nice!`;
      setTimeout(right, 700);
    } else {
      heard.textContent = got.length ? `🎤 Heard “${got[0]}”. You decide: ✓ or ✗.` : '🎤 Didn\'t catch that. You decide: ✓ or ✗.';
    }
  };
  btns.appendChild(b);
}

// ---------- car mode: the app talks, the child reads, the driver just says "yes" or "again" ----------
const PRAISE = ['Yes!', 'You got it.', 'Nice reading!', "That's it!", 'Great!'];
const praise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const spoken = w => (w === 'i' ? 'I' : w);

async function carRun(item, fixing) {
  const tok = ++R.token;
  const live = () => R && R.token === tok && !$('#lesson').hidden;
  try { speechSynthesis.cancel(); } catch {}
  const name = kid().name;
  const S0 = item.u ? SOUNDS[soundOf(item.u)] : null;
  const howTo = S0 ? `the sound at the start of “${S0.as}”. ${S0.hold ? 'Hold it long.' : 'Say it quick.'}` : '';
  let lines = [], want = null, secs = 6;

  if (!fixing) {
    if (item.t === 'new') lines = [`New sound, ${name}! Look at the letter.`, `Grown-up, say ${howTo}`, 2500, 'Now say it together.', 2500, `${name}, your turn. What sound?`];
    if (item.t === 'tricky') { lines = [`Tricky word, ${name}. This word is ${spoken(item.w)}.`, `${name}, what word?`]; want = spoken(item.w); }
    if (item.t === 'sound') {
      lines = [`${name}, what sound?`];
      if (!R.told) { R.told = true; lines.push('Grown-up, say yes if that was right, or again.'); }
    }
    if (item.t === 'hear') { lines = [`Grown-up, say “${item.w}” slowly, one sound at a time.`, 4500, `${name}, say it fast!`]; want = item.w; }
    if (item.t === 'word') { lines = [`${name}, sound it out. Then say it fast.`]; want = item.w; secs = 10; }
    if (item.t === 'story') {
      kidCard.innerHTML = `<p class="story">${esc(item.s)}</p>`;
      script.innerHTML = you('“Read the sentence.”') + they(`<b>${esc(item.s.replace(/^./, c => c.toUpperCase()))}</b>`) +
        note('Help with any word they get stuck on, then say “again” to have them read it once more.');
      setButtons([['✓ Right', 'yes', right], ['✗ Not yet', 'no', () => { R.missed.add(item); carRun(item, true); }]]);
      lines = [`${name}, read the sentence.`]; want = item.s; secs = 16;
    }
    if (item.t === 'q') {
      await speak(item.q[0]); if (!live()) return;
      heard.textContent = '💬 Talk about it…';
      await sleep(8000); if (!live()) return;
      await speak('Great thinking.'); if (live()) next(false);
      return;
    }
  } else {
    if (item.t === 'new' || item.t === 'sound') lines = [`Grown-up, say ${howTo}`, 2500, 'Say it together.', 2500, `${name}, your turn.`];
    if (item.t === 'tricky') { lines = [`This word is ${spoken(item.w)}. Say it with me.`, 2000, `${name}, what word?`]; want = spoken(item.w); }
    if (item.t === 'hear') { lines = [`Grown-up, say “${item.w}” slowly again. Then say it fast.`, 5000, `${name}, your turn. Say it fast.`]; want = item.w; }
    if (item.t === 'word') { lines = [`That word is ${item.w}. Grown-up, sound it out with ${name}.`, 5000, `${name}, say it fast.`]; want = item.w; }
    if (item.t === 'story') {
      script.innerHTML = note('<b>Read it to them, then they read it.</b>') + they(`<b>${esc(item.s.replace(/^./, c => c.toUpperCase()))}</b>`);
      lines = ['Listen.', { slow: item.s }, `Now you read it, ${name}.`]; want = item.s; secs = 16;
    }
  }

  const sayAll = async () => {
    for (const l of lines) {
      if (!live()) return;
      if (typeof l === 'number') await sleep(l);
      else if (l.slow) await speak(l.slow, 0.7);
      else await speak(l);
    }
  };
  await sayAll();

  const onRight = async () => {
    await speak(praise()); if (!live()) return;
    if (fixing && item.t !== 'story') { R.queue.shift(); R.queue.length ? step() : next(false); }
    else if (item.t === 'story' && R.missed.has(item)) next(false);
    else right();
  };
  const onWrong = () => {
    if (item.t === 'story') { R.missed.add(item); return carRun(item, true); }
    ({ new: fixSound, sound: fixSound, tricky: fixTricky, hear: fixHear, word: fixWord })[item.t](item);
  };

  for (let tries = 0; tries < 3; tries++) {
    if (!live()) return;
    heard.textContent = '🎤 Listening…';
    const got = await listen(secs);
    if (!live()) return;
    heard.textContent = got.length ? `🎤 Heard “${got[0]}”` : '';
    if (want && got.some(g => matches(g, want))) return onRight();
    const c = command(got);
    if (c === 'yes') return onRight();
    if (c === 'no') return onWrong();
    if (c === 'skip') { await speak("Okay, let's skip that one."); return live() && next(false); }
    if (c === 'stop') { stopLesson(); return; }
    if (c === 'repeat') { await sayAll(); tries--; continue; }
    if (tries < 2) { await speak('Grown-up, was that right? Say yes, or again.'); secs = 5; }
  }
  if (live()) heard.textContent = 'Paused. Tap ✓ or ✗ to keep going.';
}

let wake = null;
async function keepAwake() {
  try { wake = await navigator.wakeLock?.request('screen'); } catch {}
}
function stopLesson() {
  if (R) R.token = -1;
  try { speechSynthesis.cancel(); } catch {}
  try { wake?.release(); } catch {}
  document.body.classList.remove('car');
  show('home'); renderHome();
}

// ---------- finish ----------
function finish() {
  const k = kid();
  const pct = R.total ? Math.round(100 * R.firstTry / R.total) : 100;
  const firm = pct >= 70;
  k.done = k.done || {};
  k.done[R.i] = { at: new Date().toISOString().slice(0, 10), pct };
  if (firm && R.i >= k.lesson) k.lesson = Math.min(R.i + 1, LESSONS.length - 1);
  if (firm && R.i === LESSONS.length - 1) k.finishedAll = true;
  save();
  show('done');
  if (R.car) { R.token++; speak(firm ? `Lesson done! ${k.name}, you read ${R.firstTry} of ${R.total} on the first try. Wonderful.` : `Lesson done. Let's do this one again next time.`); }
  $('#doneTitle').textContent = `Lesson ${R.i + 1} done! ⭐`;
  $('#doneText').innerHTML =
    `${esc(k.name)} got <b>${R.firstTry} of ${R.total}</b> right the first time.<br>` +
    (firm
      ? (R.i === LESSONS.length - 1 ? 'That was the last lesson here. Wonderful work.' : `Next time: lesson ${k.lesson + 1}.`)
      : `That's under 70%, so do lesson ${R.i + 1} again next time before moving on. Going back is part of the method, not a step backward.`);
}

// ---------- settings + wiring ----------
function renderSettings() {
  const m = $('#micToggle');
  m.checked = !!S.mic;
  m.disabled = !canListen;
  $('#micNote').textContent = canListen
    ? 'Adds a 🎤 button for words and sentences. If the mic hears the right word, it moves on. If not, you decide. It never marks a word wrong by itself.'
    : 'This browser can\'t listen. Chrome, Edge and Safari can.';
}

$('#micToggle').onchange = e => { S.mic = e.target.checked; save(); };
$('#btnQuit').onclick = stopLesson;
$('#btnHome').onclick = stopLesson;
$('#btnAgain').onclick = () => startLesson(R.i, R.car);
$('#btnNext').onclick = () => startLesson(kid().lesson, R?.car);
$('#btnSettings').onclick = () => { renderSettings(); $('#settings').hidden = !$('#settings').hidden; };
$('#btnReset').onclick = () => {
  const k = kid(); if (!k) return;
  const b = $('#btnReset');
  if (b.dataset.sure !== k.id) { b.dataset.sure = k.id; b.textContent = `Tap again to remove ${k.name} and their progress`; return; }
  b.dataset.sure = ''; b.textContent = 'Remove this reader';
  {
    S.kids = S.kids.filter(x => x.id !== k.id); S.current = S.kids[0]?.id || null; save(); renderHome();
  }
};

renderSettings();
renderHome();
show('home');
