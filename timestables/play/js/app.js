// Times Table Road Trip on the web: same game, coach and modes as the iPhone app.
import { OPS, OP, storeKey, findItem, groups, question, KIND_NAME, ITEMS, factKey, nowRef } from './modes.js';
import * as Coach from './coach.js';
import { tipFor } from './tips.js';
import * as Voice from './voice.js?v=5';
import * as Cloud from './cloud.js';

const $ = id => document.getElementById(id);
const AVATARS = ['🦖', '🦅', '🐙', '🦊', '🐉', '🦈', '🐯', '🚀', '🦄', '🐸', '🐼', '🦁', '🐵', '🐢', '🦉', '🐬'];
const MAX_PLAYERS = 4, MAX_FAMILY = 10;

// MARK: Saving (this browser; signed-in players also save to their Google account)

const LS = 'ttrt.';
const load = (k, fallback) => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch {} };

let settings = Object.assign({ players: [], perPlayer: 10, useVoice: Voice.canListen, voiceID: null, voiceSpeed: 1, mode: 'mul', grade: '' }, load('settings', {}));
const memories = {}, skillSets = {}, resultSets = {};
for (const op of OPS) {
  memories[op] = load(storeKey(op, 'memory'), {});
  skillSets[op] = load(storeKey(op, 'skills'), {});
  resultSets[op] = load(storeKey(op, 'results'), []);
}
const saveSettings = () => save('settings', settings);
const saveProgress = op => { save(storeKey(op, 'memory'), memories[op]); save(storeKey(op, 'skills'), skillSets[op]); save(storeKey(op, 'results'), resultSets[op]); };
const family = () => settings.players;
const playingNow = () => settings.players.filter(p => p.playing);
const uuid = () => crypto.randomUUID?.() ?? 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);

function skill(pid, op) {
  if (skillSets[op][pid]) return skillSets[op][pid];
  const mem = memories[op][pid] ?? {};
  const s = Coach.rebuild(mem, op);
  const m = skillSets.mul[pid];
  // A new mode starts from what the coach knows about their times tables.
  if (op !== 'mul' && !Object.keys(mem).length && m && m.answers >= 10) {
    s.theta = op === 'div' ? m.theta - 0.3 : m.theta;
    if (op === 'div') s.numbers = { ...m.numbers };
    s.clock = m.clock;
  }
  skillSets[op][pid] = s;
  return s;
}

// MARK: Account (Google sign-in)

let user = null;

function mergeResults(a, b) {
  const seen = new Set(), out = [];
  for (const r of [...a, ...b].sort((x, y) => x.date - y.date)) {
    const id = `${r.player}|${Math.round(r.date * 1000)}|${r.points}`;
    if (!seen.has(id)) { seen.add(id); out.push(r); }
  }
  return out.slice(-2000);
}
function mergeFacts(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, f] of Object.entries(b)) {
    const mine = out[k];
    const newer = (f.history?.at(-1)?.at ?? 0) > (mine?.history?.at(-1)?.at ?? 0);
    if (!mine || f.seen > mine.seen || (f.seen === mine.seen && newer)) out[k] = f;
  }
  return out;
}

async function signedIn(u) {
  user = u;
  if (!u) { renderHome(); return; }
  // The account is a player in the family, saved under the Google account's id.
  let p = settings.players.find(p => p.id === u.uid);
  if (!p) {
    p = { id: u.uid, name: Cloud.shortName(u), avatar: AVATARS[settings.players.length % AVATARS.length], playing: playingNow().length < MAX_PLAYERS };
    settings.players.unshift(p);
  }
  p.account = true;
  try {
    const acct = await Cloud.loadAccount(u.uid);
    if (acct) {
      if (acct.profile.avatar) p.avatar = acct.profile.avatar;
      if (acct.profile.name) p.name = acct.profile.name;
      if (acct.profile.grade && !settings.grade) settings.grade = acct.profile.grade;
      for (const op of OPS) {
        memories[op][u.uid] = mergeFacts(memories[op][u.uid], acct.progress[storeKey(op, 'memory')]);
        const cs = acct.progress[storeKey(op, 'skills')];
        if (cs && (!skillSets[op][u.uid] || cs.answers > skillSets[op][u.uid].answers)) skillSets[op][u.uid] = cs;
        resultSets[op] = mergeResults(resultSets[op], acct.progress[storeKey(op, 'results')] ?? []);
        saveProgress(op);
      }
    }
    await pushAccount();
  } catch (e) { console.warn('cloud load failed', e); notice('Couldn’t reach your Google account just now. Playing on this computer; it’ll save when you’re back online.'); }
  saveSettings();
  renderHome();
}

const weekId = d => { const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - (t.getDay() + 6) % 7); const w1 = new Date(t.getFullYear(), 0, 4); return `${t.getFullYear()}-W${1 + Math.round(((t - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7)}`; };
const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime() / 1000 - 978307200; };

/** Save the signed-in player's progress to their account, and their school leaderboard row. */
async function pushAccount() {
  if (!user) return;
  const me = settings.players.find(p => p.id === user.uid);
  const progress = {};
  const points = {}, week = { id: weekId(Date.now()) };
  for (const op of OPS) {
    progress[storeKey(op, 'memory')] = memories[op][user.uid] ?? {};
    progress[storeKey(op, 'skills')] = skillSets[op][user.uid] ?? Coach.newSkill();
    const mine = resultSets[op].filter(r => r.player === user.uid);
    progress[storeKey(op, 'results')] = mine;
    points[op] = mine.reduce((t, r) => t + r.points, 0);
    week[op] = mine.filter(r => r.date >= weekStart()).reduce((t, r) => t + r.points, 0);
  }
  await Cloud.saveAccount(user.uid, { name: me?.name, avatar: me?.avatar, grade: settings.grade }, progress);
  await Cloud.saveBoardRow(user, { name: me?.name ?? Cloud.shortName(user), avatar: me?.avatar ?? '🦖', grade: settings.grade || '', points, week });
}

// MARK: Home

function segs(el, options, current, onPick) {
  el.innerHTML = '';
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.textContent = label;
    if (value === current) b.className = 'on';
    b.onclick = () => onPick(value);
    el.append(b);
  }
}

function notice(text) { const n = $('notice'); n.textContent = text ?? ''; n.hidden = !text; }

function renderAccount() {
  const el = $('account');
  el.innerHTML = '';
  if (!Cloud.available) return;
  if (user) {
    const who = document.createElement('span'); who.className = 'who';
    who.textContent = `Saving to ${user.email}`;
    const out = document.createElement('button'); out.className = 'link'; out.textContent = 'Sign out';
    out.onclick = async () => { await Cloud.signOut(); settings.players = settings.players.filter(p => !p.account); saveSettings(); };
    el.append(who, out);
  } else {
    const b = document.createElement('button');
    b.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> Sign in with Google';
    b.onclick = async () => { try { await Cloud.signIn(); } catch (e) { if (e?.code !== 'auth/popup-closed-by-user') notice(signInHelp(e)); } };
    el.append(b);
  }
}

function signInHelp(e) {
  if (/admin|restricted|disallowed|access_denied/i.test(e?.message ?? '')) return 'Your school’s Google account isn’t allowed to sign in to this game yet. A grown-up at school can ask the school’s tech person to allow “Times Table Road Trip”. You can still play; scores save on this computer.';
  return 'Sign-in didn’t work. You can still play; scores save on this computer.';
}

function renderHome() {
  renderAccount();
  segs($('modeSegs'), OPS.map(o => [o, OP[o].label]), settings.mode, v => { settings.mode = v; boardOp = v; saveSettings(); renderHome(); });
  const box = $('players');
  box.innerHTML = '';
  for (const p of family()) {
    const t = document.createElement('div');
    t.className = 'tile' + (p.playing ? ' on' : '');
    t.innerHTML = `<button class="face" aria-label="${esc(p.name)}">${p.avatar}</button><span class="check">✓</span><span class="name">${esc(p.name)}</span>${p.account ? '<span class="acct">Google</span>' : ''}<button class="edit" aria-label="Edit ${esc(p.name)}">✏️</button>`;
    t.querySelector('.face').onclick = () => toggle(p);
    t.querySelector('.edit').onclick = () => editPlayer(p);
    box.append(t);
  }
  if (family().length < MAX_FAMILY) {
    const t = document.createElement('div');
    t.className = 'tile add';
    t.innerHTML = '<button class="face" aria-label="Add player">+</button><span class="name">Add player</span>';
    t.querySelector('.face').onclick = () => editPlayer(null);
    box.append(t);
  }
  $('editHint').hidden = !family().length;
  $('whoHint').textContent = family().length ? 'Tap everyone who’s in this game.' : (Cloud.available && !user ? 'Sign in with Google to save your scores, or add a player.' : 'Add everyone who’ll play.');
  segs($('countSegs'), [[5, '5 each'], [10, '10 each'], [15, '15 each']], settings.perPlayer, v => { settings.perPlayer = v; saveSettings(); renderHome(); });
  const voiceOpts = Voice.canListen ? [[true, '🎤 Say it'], [false, '⌨️ Type it']] : [[false, '⌨️ Type it']];
  if (!Voice.canListen) settings.useVoice = false;
  segs($('voiceSegs'), voiceOpts, settings.useVoice, v => { settings.useVoice = v; saveSettings(); renderHome(); });
  const names = playingNow().map(p => p.name);
  $('btnStart').textContent = !names.length ? 'Pick who’s playing' : names.length === 1 ? `▶ Start: ${names[0]}` : names.length === 2 ? `▶ Start: ${names[0]} & ${names[1]}` : `▶ Start: ${names.length} players`;
  $('btnStart').disabled = !names.length;
  $('voiceHint').hidden = !settings.useVoice;
  renderBoard();
}

function toggle(p) {
  if (p.playing) p.playing = false;
  else if (playingNow().length < MAX_PLAYERS) p.playing = true;
  else { $('whoHint').textContent = `Up to ${MAX_PLAYERS} can play at once.`; return; }
  saveSettings(); renderHome();
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// MARK: Leaderboard

let boardScope = 'family', boardOp = null, boardWeek = true, schoolRows = null;

function familyRows(ops) {
  const start = weekStart();
  return family().map(p => {
    const rs = ops.flatMap(o => resultSets[o]).filter(r => r.player === p.id && (!boardWeek || r.date >= start));
    const right = rs.reduce((t, r) => t + r.right, 0), asked = rs.reduce((t, r) => t + r.asked, 0);
    const auto = ops.reduce((n, o) => n + Object.values(memories[o][p.id] ?? {}).filter(f => Coach.mastery(f) === 'automatic').length, 0);
    return { id: p.id, name: p.name, avatar: p.avatar, points: rs.reduce((t, r) => t + r.points, 0), rounds: rs.length,
      wins: rs.filter(r => r.won).length, percent: asked ? Math.round(right / asked * 100) : 0, auto };
  }).sort((a, b) => b.points - a.points || b.auto - a.auto);
}

function boardRows(ops) {
  if (boardScope === 'family') return familyRows(ops);
  const wk = weekId(Date.now());
  return (schoolRows ?? [])
    .filter(r => boardScope === 'school' || (settings.grade && r.grade === settings.grade))
    .map(r => ({ id: r.uid, name: r.name, avatar: r.avatar, me: r.uid === user?.uid,
      points: ops.reduce((t, o) => t + (boardWeek ? (r.week?.id === wk ? r.week?.[o] ?? 0 : 0) : r.points?.[o] ?? 0), 0) }))
    .filter(r => r.points > 0 || r.me)
    .sort((a, b) => b.points - a.points)
    .slice(0, 25);
}

async function renderBoard() {
  const el = $('board');
  if (!family().length) { el.hidden = true; return; }
  el.hidden = false;
  if (boardOp === undefined || (boardOp !== null && !OPS.includes(boardOp))) boardOp = settings.mode;
  const school = user && Cloud.schoolOf(user);
  if (!school) boardScope = 'family';
  const ops = boardOp ? [boardOp] : OPS;
  el.innerHTML = `<h3>🏆 Leaderboard <small>${boardOp ? OP[boardOp].noun.replace(/^./, c => c.toUpperCase()) : 'All modes'}</small></h3>`;
  if (school) {
    const s = document.createElement('div'); s.className = 'segs';
    segs(s, [['family', '🏠 Family'], ['school', '🏫 School'], ['grade', settings.grade ? `Grade ${settings.grade}` : 'Grade']], boardScope, async v => {
      boardScope = v;
      if (v === 'grade' && !settings.grade) { openSettings(); return; }
      if (v !== 'family') schoolRows = await Cloud.loadBoard(user).catch(() => []);
      renderBoard();
    });
    el.append(s);
  }
  const m = document.createElement('div'); m.className = 'segs';
  segs(m, [...OPS.map(o => [o, OP[o].symbol]), [null, 'All']], boardOp, v => { boardOp = v; renderBoard(); });
  const w = document.createElement('div'); w.className = 'segs';
  segs(w, [[true, 'This week'], [false, 'All time']], boardWeek, v => { boardWeek = v; renderBoard(); });
  el.append(m, w);
  if (boardScope !== 'family' && schoolRows === null) schoolRows = await Cloud.loadBoard(user).catch(() => []);
  const rows = boardRows(ops);
  if (!rows.length || rows.every(r => !r.points)) {
    const p = document.createElement('p'); p.className = 'muted small';
    p.textContent = boardScope === 'family' ? (boardWeek ? 'No rounds yet this week. Finish a round to get on the board!' : 'Finish a round to get on the board!')
      : 'No one from your school has played yet. Be the first!';
    el.append(p);
    if (boardScope === 'family') return;
  }
  rows.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'rowItem' + (r.rounds === 0 ? ' dim' : '') + (r.me ? ' me' : '');
    const detail = boardScope === 'family'
      ? (r.rounds ? [`${r.rounds} round${r.rounds === 1 ? '' : 's'}`, r.wins ? `🏆 ${r.wins}` : '', `${r.percent}% right`, `✅ ${r.auto} mastered`].filter(Boolean).join(' · ') : `No rounds ${boardWeek ? 'this week' : 'yet'} · ✅ ${r.auto} mastered`)
      : '';
    d.innerHTML = `<div class="medal">${r.points ? (['🥇', '🥈', '🥉'][i] ?? i + 1) : '–'}</div><div class="av">${r.avatar}</div><div class="info"><b>${esc(r.name)}</b><span>${detail}</span></div><div class="score"><b>${r.points.toLocaleString()}</b><span>points</span></div>`;
    el.append(d);
  });
}

// MARK: Players

let editing = null, dlgAvatar = '🦖';
function editPlayer(p) {
  editing = p;
  $('playerDlgTitle').textContent = p ? 'Edit player' : 'Add a player';
  $('dlgName').value = p?.name ?? '';
  dlgAvatar = p?.avatar ?? AVATARS[family().length % AVATARS.length];
  $('dlgDelete').hidden = !p || p.account;
  drawAnimals();
  $('playerDlg').showModal();
  if (!p) $('dlgName').focus();
}
function drawAnimals() {
  $('dlgAvatar').textContent = dlgAvatar;
  const g = $('animals'); g.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = a;
    if (a === dlgAvatar) b.className = 'on';
    b.onclick = () => { dlgAvatar = a; drawAnimals(); };
    g.append(b);
  }
}
// Enter in the name box saves (otherwise the form's first button, Cancel, would win).
$('dlgName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('playerDlg').close('save'); } });
$('playerDlg').addEventListener('close', () => {
  const v = $('playerDlg').returnValue, name = $('dlgName').value.trim();
  if (v === 'save' && name) {
    if (editing) { editing.name = name; editing.avatar = dlgAvatar; }
    else settings.players.push({ id: uuid(), name, avatar: dlgAvatar, playing: playingNow().length < MAX_PLAYERS });
    saveSettings(); if (editing?.account) pushAccount().catch(() => {});
  } else if (v === 'delete' && editing && confirm(`Delete ${editing.name} forever? This erases their scores and everything the coach learned about them.`)) {
    settings.players = settings.players.filter(p => p.id !== editing.id);
    for (const op of OPS) { delete memories[op][editing.id]; delete skillSets[op][editing.id]; resultSets[op] = resultSets[op].filter(r => r.player !== editing.id); saveProgress(op); }
    saveSettings();
  }
  renderHome();
});

// MARK: Settings

function openSettings() {
  const sel = $('voiceSel'); sel.innerHTML = '';
  const vs = Voice.voices();
  if (!vs.length) sel.append(new Option('Default voice', ''));
  for (const v of vs) sel.append(new Option(`${v.name}`, v.voiceURI));
  sel.value = settings.voiceID ?? '';
  $('speed').value = settings.voiceSpeed;
  const gs = $('gradeSel');
  if (gs.options.length === 1) for (const g of ['K', '1', '2', '3', '4', '5', '6', '7', '8']) gs.append(new Option(g === 'K' ? 'Kindergarten' : `Grade ${g}`, g));
  gs.value = settings.grade ?? '';
  $('gradeSection').hidden = !(user && Cloud.schoolOf(user));
  $('privacyText').textContent = Cloud.available
    ? 'No ads, no tracking. Without signing in, names and scores stay in this browser. Signing in with Google saves your progress to your account so it follows you, and a school account shows your first name and last initial on your school’s leaderboard, only to others at your school. Listening uses your browser’s speech recognition (in Chrome, Google turns speech into text).'
    : 'No accounts, ads or tracking. Names and scores stay in this browser. Listening uses your browser’s speech recognition (in Chrome, Google turns speech into text).';
  $('settingsDlg').showModal();
}
$('voiceSel').onchange = e => { settings.voiceID = e.target.value || null; saveSettings(); Voice.setVoice(settings.voiceID, settings.voiceSpeed); Voice.say('What is 7 times 8?'); unlockSound(); };
$('speed').oninput = e => { settings.voiceSpeed = +e.target.value; saveSettings(); Voice.setVoice(settings.voiceID, settings.voiceSpeed); };
$('btnHear').onclick = () => { Voice.setVoice(settings.voiceID, settings.voiceSpeed); Voice.say(`Hi ${playingNow()[0]?.name ?? 'friend'}! What is 7 times 8?`); unlockSound(); };
$('gradeSel').onchange = e => { settings.grade = e.target.value; saveSettings(); pushAccount().catch(() => {}); };
$('btnMicTest').onclick = async () => {
  const r = $('micReport');
  if (!Voice.canListen) { r.textContent = '❌ This browser can’t listen. Use Chrome, or choose “Type it”.'; return; }
  Voice.setVoice(settings.voiceID, settings.voiceSpeed);
  const said = Voice.say('Say a number, like fifty six.');
  unlockSound();
  await said;
  r.textContent = 'Listening… say a number';
  const res = await Voice.listen({ seconds: 7, commands: false, onHeard: t => { if (t) r.textContent = `Hearing “${t}”…`; } });
  if (res.type === 'number') { r.textContent = `✅ Heard ${res.value} (“${res.heard}”).`; Voice.say(`I heard ${res.value}. Ready to play!`); }
  else if (res.why === 'unavailable') r.textContent = '❌ The microphone is blocked. Click the 🔒 or 🎤 icon in the address bar and allow the microphone. (On a school Chromebook, the school may have turned it off: use “Type it”.)';
  else r.textContent = `Hmm, I didn’t catch a number${res.heard ? ` (heard “${res.heard}”)` : ''}. Try again a bit louder.`;
};
$('settingsDlg').addEventListener('close', renderHome);

// MARK: Sounds (made in code, no files)

let actx;
/** Turn sound on. Must run inside a tap/click (browsers block sound that doesn't). */
function unlockSound() {
  Voice.loudSpeaker();
  Voice.unlock();
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state !== 'running') actx.resume();
    const b = actx.createBuffer(1, 1, 22050), src = actx.createBufferSource();
    src.buffer = b; src.connect(actx.destination); src.start(0);
  } catch {}
  Voice.loudSpeaker();
  $('soundBtn').hidden = true;
}
function tone(freqs, dur = 0.15, gap = 0.09, vol = 0.3, type = 'sine') {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    freqs.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * gap;
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
    });
  } catch {}
}
const sfx = {
  good: () => tone([660, 880, 1320]), fast: () => tone([660, 880, 1100, 1320, 1760], 0.12, 0.06),
  bad: () => tone([220, 165], 0.25, 0.18, 0.15, 'square'), listen: () => tone([990], 0.08, 0, 0.2), win: () => tone([523, 659, 784, 1047, 784, 1047], 0.2, 0.12),
};

// MARK: The game

const PRAISE = ['Yes!', 'Correct!', 'You got it!', 'Nice!', 'Boom!', 'Awesome!', 'Right on!'];
const FAST_PRAISE = ['Lightning fast!', 'Whoa, speedy!', 'Super quick!', 'Zoom!'];
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const streakLine = (n, name) => (n === 3 ? `${name} is on fire! Three in a row!` : n === 5 ? 'Five in a row! Unstoppable!' : 'Ten in a row! Legendary!');

let G = null; // the game in progress

function show(id) { for (const s of ['home', 'game', 'results', 'stats']) $(s).hidden = s !== id; window.scrollTo(0, 0); }

function setMic(state, text) { $('mic').className = 'mic ' + state; $('micText').textContent = text ?? ({ listening: 'Listening…', speaking: 'Talking…', paused: 'Paused', tap: 'Type your answer' }[state] ?? ''); }

async function start() {
  if (G) G.quit = true;
  Voice.stopListening({ type: 'nothing', why: 'quit' });
  // Speak before the tap sound. On an iPhone the first spoken line has to be queued
  // during this tap, and starting other audio first makes that line silent.
  Voice.setVoice(settings.voiceID, settings.voiceSpeed);
  notice(null);
  const op = settings.mode;
  G = { op, quit: false, paused: false, usingVoice: settings.useVoice && Voice.canListen, recent: [], turn: 0, pending: null, tapResolve: null, unpause: null,
    players: playingNow().map(c => ({ c, points: 0, right: 0, asked: 0, streak: 0, best: 0, misses: [], fastest: null, retry: [], retried: new Set(), recent: [], milestones: [], roundSecs: [],
      masteredAtStart: Coach.masteredGroups(op, memories[op][c.id] ?? {}) })) };
  const g = G;
  show('game');
  $('keypad').hidden = g.usingVoice; $('entry').hidden = g.usingVoice; $('heard').hidden = !g.usingVoice;
  renderScores();
  const names = g.players.map(p => p.c.name);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0];
  setMic('speaking');
  // Queue the first line before any other sound, still inside the tap on Start.
  const intro = Voice.say(`Let's go! ${list}, you ${names.length > 1 ? 'each get' : 'get'} ${settings.perPlayer} ${op === 'mul' ? '' : OP[op].noun + ' '}questions.`);
  unlockSound();
  try { await navigator.wakeLock?.request('screen'); } catch {}
  await intro;
  while (!g.quit) {
    if (g.players.every(p => p.asked >= settings.perPlayer)) break;
    const i = g.turn % g.players.length;
    if (g.players[i].asked >= settings.perPlayer) { g.turn++; continue; }
    if (g.paused) await waitUnpaused(g);
    if (g.quit) return;
    await askOne(g, i);
    if (g.quit) return;
    g.turn++;
  }
  if (!g.quit) finish(g, false);
}

function nextQuestion(g, i) {
  const p = g.players[i];
  const r = p.retry.findIndex(x => x.due <= p.asked);
  if (r >= 0) return p.retry.splice(r, 1)[0].q;
  const mem = memories[g.op][p.c.id] ?? {};
  return Coach.pick(g.op, skill(p.c.id, g.op), mem, [...p.recent, ...Coach.recentKeys(mem)].slice(0, 15), g.recent);
}

const questionLine = (g, i, q) => (g.players.length > 1 ? `${g.players[i].c.name}, what's ${q.spoken}?` : `What's ${q.spoken}?`);

function renderScores() {
  const g = G, cur = g.turn % g.players.length;
  $('scores').innerHTML = g.players.map((p, i) => `<div class="sc${i === cur ? ' turn' : ''}"><b>${p.c.avatar} ${esc(p.c.name)}</b><strong>${p.points}</strong><span>${p.right}/${p.asked}${p.asked ? ` · ${Math.round(p.right / p.asked * 100)}%` : ''}${p.streak >= 3 ? ` · 🔥${p.streak}` : ''}</span></div>`).join('');
  const total = g.players.length * settings.perPlayer;
  $('progressBar').style.width = `${g.players.reduce((t, p) => t + p.asked, 0) / total * 100}%`;
}

function feedback(kind) { $('stage').className = 'stage' + (kind ? ' ' + kind : ''); }

async function askOne(g, i) {
  const p = g.players[i];
  const q = nextQuestion(g, i);
  const pid = p.c.id;
  p.recent = [q.key, ...p.recent].slice(0, 4);
  g.recent.unshift(q.key);
  renderScores();
  $('who').textContent = `${p.c.avatar} ${p.c.name}'s turn`;
  $('problem').textContent = q.text; $('problem').className = 'problem';
  $('badge').innerHTML = '&nbsp;'; $('tip').hidden = true; $('heard').innerHTML = '&nbsp;'; $('entry').textContent = '?';
  feedback(null);
  const it = findItem(g.op, q.key);
  const chance = it ? Coach.pCorrect(skill(pid, g.op), memories[g.op][pid]?.[q.key], it) : 0.5;
  const trick = tipFor(q);
  setMic('speaking');
  await Voice.say(questionLine(g, i, q));

  let tries = 0, result, elapsed = 0;
  for (;;) {
    if (g.quit) return;
    if (g.paused) { await waitUnpaused(g); if (g.quit) return; setMic('speaking'); await Voice.say(`${q.spoken}?`); }
    const t0 = performance.now();
    if (g.pending) { result = g.pending; g.pending = null; } else result = await getAnswer(g, q, skill(pid, g.op).clock * q.clockScale);
    elapsed = (performance.now() - t0) / 1000;
    if (g.quit) return;
    if (result.type === 'command' && result.value === 'repeat') { setMic('speaking'); await Voice.say(`${q.spoken}?`); continue; }
    if (result.type === 'command' && result.value === 'pause') { pauseTapped(); continue; }
    if (result.type === 'command' && result.value === 'skip') { result = { type: 'skip' }; break; }
    if (result.type === 'nothing' && (result.why === 'paused' || result.why === 'quit')) continue;
    if (result.type === 'nothing' && result.why === 'unavailable') {
      g.usingVoice = false; $('keypad').hidden = false; $('entry').hidden = false; $('heard').hidden = true;
      notice('Couldn’t use the microphone, so we switched to typing.');
      await Voice.say("I can't hear right now, so let's type the answers.");
      continue;
    }
    if (result.type === 'nothing' && result.why === 'timeout' && ++tries < 2) { setMic('speaking'); await Voice.say(`I didn't hear that. ${q.spoken}?`); continue; }
    break;
  }

  p.asked++;
  const correct = result.type === 'number' && result.value === q.answer;
  const fast = correct && elapsed <= Coach.FAST_SECS;
  record(g, pid, q, correct, elapsed);
  if (correct) p.roundSecs.push(elapsed);
  setMic('idle', ' ');
  $('problem').textContent = q.full;
  if (correct) {
    p.right++; p.streak++; p.best = Math.max(p.best, p.streak);
    const tough = chance < 0.7;
    const earned = Coach.speedPoints(elapsed, g.listenSeconds) + (tough ? 5 : 0) + (p.streak >= 3 ? 2 : 0);
    p.points += earned;
    if (fast && elapsed < (p.fastest?.secs ?? Infinity)) p.fastest = { q, secs: elapsed };
    feedback('good'); fast ? sfx.fast() : sfx.good();
    let badge = (fast ? '⚡ Lightning!' : '✅ Correct!') + ` +${earned}` + (tough ? ' 💪' : '');
    let line = pickOne(fast ? FAST_PRAISE : PRAISE);
    if ([3, 5, 10].includes(p.streak)) { line += ' ' + streakLine(p.streak, p.c.name); badge += ' ' + '🔥'.repeat(p.streak === 3 ? 1 : p.streak === 5 ? 2 : 3); }
    $('badge').textContent = badge;
    renderScores();
    await Voice.say(line);
  } else {
    p.streak = 0; p.misses.push(q);
    if (!p.retried.has(q.key)) { p.retried.add(q.key); p.retry.push({ q, due: p.asked + 3 }); }
    feedback('bad'); sfx.bad();
    if (trick) { $('tip').textContent = '💡 ' + trick; $('tip').hidden = false; $('problem').className = 'problem withTip'; }
    renderScores();
    const lead = result.type === 'skip' ? 'Skipped. ' : result.type === 'number' ? 'Not quite. ' : '';
    await Voice.say(lead + q.factLine + (trick ? ' ' + trick : ''), { slower: true });
  }
  await new Promise(r => setTimeout(r, 150));
}

let timerRaf;
function runTimer(seconds) {
  const t0 = performance.now();
  cancelAnimationFrame(timerRaf);
  const tick = () => {
    const el = (performance.now() - t0) / 1000, f = Math.max(0, 1 - el / seconds);
    $('timerFill').style.width = `${f * 100}%`;
    $('timerFill').style.background = f > 0.5 ? 'var(--good)' : f > 0.2 ? 'var(--gold)' : 'var(--bad)';
    $('pts').textContent = `+${Coach.speedPoints(el, seconds)}`; $('pts').className = 'pts live';
    if (f > 0) timerRaf = requestAnimationFrame(tick);
  };
  tick();
}
function stopTimer() { cancelAnimationFrame(timerRaf); $('timerFill').style.width = '0'; $('pts').className = 'pts'; $('pts').textContent = '+15'; }

async function getAnswer(g, q, clock) {
  g.listenSeconds = clock * (g.usingVoice ? 1 : 1.5);
  runTimer(g.listenSeconds);
  try {
    if (g.usingVoice) {
      setMic('listening'); sfx.listen();
      return await Voice.listen({ seconds: g.listenSeconds, expect: q.answer, commands: true, max: OP[g.op].max,
        onHeard: t => { $('heard').textContent = t ? `“${t}”` : ' '; } });
    }
    setMic('tap');
    $('entry').textContent = '?';
    return await new Promise(resolve => {
      const timer = setTimeout(() => done({ type: 'nothing', why: 'timeout' }), g.listenSeconds * 1000);
      const done = r => { clearTimeout(timer); g.tapResolve = null; resolve(r); };
      g.tapResolve = done; g.entry = '';
    });
  } finally { stopTimer(); }
}

function record(g, pid, q, correct, secs) {
  const op = g.op, s = skill(pid, op), at = { ok: correct, secs, at: nowRef() };
  const it = findItem(op, q.key);
  if (it) Coach.update(s, it, at);
  skillSets[op][pid] = s;
  const mem = memories[op][pid] ??= {};
  const f = mem[q.key] ?? { box: 0, seen: 0, right: 0, secs: 0, history: [] };
  f.seen++; f.history = [...(f.history ?? []), at].slice(-8);
  if (correct) { f.right++; f.secs = f.secs ? f.secs * 0.6 + secs * 0.4 : secs; f.box = secs <= Coach.FAST_SECS ? Math.min(4, f.box + 1) : Math.max(f.box, 1); }
  else f.box = 0;
  mem[q.key] = f;
  saveProgress(op);
}

function keypad(k) {
  const g = G; if (!g) return;
  if (k === '⌫') g.entry = (g.entry ?? '').slice(0, -1);
  else if (k === '✓') { if (g.entry && g.tapResolve) { const v = parseInt(g.entry, 10); g.entry = ''; g.tapResolve({ type: 'number', value: v }); } }
  else if ((g.entry ?? '').length < 3) g.entry = (g.entry ?? '') + k;
  $('entry').textContent = g.entry || '?';
}
function buildKeypad() {
  const kp = $('keypad');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓']) {
    const b = document.createElement('button'); b.textContent = k; if (k === '✓') b.className = 'ok';
    b.onclick = () => keypad(k); kp.append(b);
  }
  // Chromebooks have keyboards: type the number, Enter to answer.
  document.addEventListener('keydown', e => {
    if ($('game').hidden || !G || G.usingVoice) return;
    if (/^\d$/.test(e.key)) keypad(e.key);
    else if (e.key === 'Backspace') keypad('⌫');
    else if (e.key === 'Enter') keypad('✓');
  });
}

function interrupt(r) {
  const g = G; if (!g) return;
  if (Voice.isListening()) Voice.stopListening(r);
  else if (g.tapResolve) g.tapResolve(r);
  else { g.pending = r; Voice.stopTalking(); }
}
function pauseTapped() {
  const g = G; if (!g) return;
  if (g.paused) { g.paused = false; $('btnPause').innerHTML = '⏸<span>Pause</span>'; g.unpause?.(); g.unpause = null; }
  else {
    g.paused = true; $('btnPause').innerHTML = '▶<span>Resume</span>';
    interrupt({ type: 'nothing', why: 'paused' }); g.pending = null;
    setMic('paused'); Voice.say('Paused. Tap resume when you’re ready.');
  }
}
const waitUnpaused = g => (g.paused ? new Promise(r => { g.unpause = r; setMic('paused'); }) : Promise.resolve());

function quit() {
  const g = G; if (!g) return;
  g.quit = true; Voice.stopTalking(); interrupt({ type: 'nothing', why: 'quit' }); g.unpause?.();
  if (g.players.some(p => p.asked > 0)) finish(g, true); else { show('home'); renderHome(); }
}

async function finish(g, early) {
  const op = g.op;
  if (!early) {
    for (const p of g.players) {
      if (!p.asked) continue;
      const mem = memories[op][p.c.id] ?? {};
      const now = Coach.masteredGroups(op, mem);
      for (const gr of groups(op)) if (now.has(gr.milestone) && !p.masteredAtStart.has(gr.milestone)) p.milestones.push(`${p.c.name} has mastered ${gr.milestone}!`);
      const s = skill(p.c.id, op), before = s.clock;
      const c = Coach.adjustClock(op, s, mem, p.right, p.asked, p.roundSecs.length ? p.roundSecs : [s.clock]);
      if (c) p.milestones.push(c < before ? `${p.c.name}'s clock is now ${c} seconds. Speedy!` : `${p.c.name} gets a little more time: ${c} seconds.`);
    }
    const top = Math.max(...g.players.map(p => p.points)), winners = g.players.filter(p => p.points === top).length;
    for (const p of g.players) if (p.asked) resultSets[op].push({ player: p.c.id, date: nowRef(), points: p.points, right: p.right, asked: p.asked, won: g.players.length > 1 && winners === 1 && p.points === top });
    resultSets[op] = resultSets[op].slice(-2000);
    saveProgress(op);
    if (user && g.players.some(p => p.c.id === user.uid)) pushAccount().catch(() => notice('Couldn’t save to your Google account just now; it’ll try again after your next round.'));
  }
  const ranked = [...g.players].sort((a, b) => b.points - a.points);
  $('resultsTitle').textContent = early ? 'Game ended' : ranked.length > 1 && ranked[0].points > ranked[1].points ? `🏆 ${ranked[0].c.name} wins!` : '🎉 Round over!';
  $('resultScores').innerHTML = '<div class="sectionTitle">Scores</div>' + ranked.map((p, i) => {
    const pct = p.asked ? Math.round(p.right / p.asked * 100) : 0;
    let d = `${p.right} of ${p.asked} right (${pct}%) · best streak ${p.best}`;
    if (p.asked >= 4) d += pct >= 95 ? '<br>🚀 Too easy! The coach will push harder.' : pct >= 75 ? '<br>🎯 Right in the learning zone' : '<br>🧗 Tough round. The coach will ease up a bit.';
    for (const m of p.milestones) d += `<br>⭐ ${esc(m)}`;
    if (p.fastest) d += `<br>⚡ fastest: ${p.fastest.q.text} in ${p.fastest.secs.toFixed(1)}s`;
    return `<div class="rowItem"><div class="av">${p.c.avatar}</div><div class="info"><b>${i === 0 && ranked.length > 1 && p.points > ranked[1].points ? '🏆 ' : ''}${esc(p.c.name)}</b><span>${d}</span></div><div class="score"><b>${p.points}</b></div></div>`;
  }).join('');
  $('practice').innerHTML = '<div class="sectionTitle">Practice these</div>' + ranked.map(p => {
    const seen = new Set(), misses = p.misses.filter(q => !seen.has(q.full) && seen.add(q.full));
    return `<div><b>${p.c.avatar} ${esc(p.c.name)}</b><div class="chips" style="margin-top:6px">${misses.length ? misses.map(q => `<span class="chip">${q.full}</span>`).join('') : '<span class="muted">Perfect round! 🌟</span>'}</div></div>`;
  }).join('');
  $('againHint').hidden = !g.usingVoice;
  show('results');
  try { navigator.wakeLock && (await navigator.wakeLock.request('screen')).release(); } catch {}
  if (early) return;
  sfx.win(); confetti();
  let speech = 'Round over! ';
  if (ranked.length > 1) {
    speech += ranked.map(p => `${p.c.name} got ${p.right} out of ${p.asked}, for ${p.points} points.`).join(' ');
    speech += ranked[0].points > ranked[1].points ? ` ${ranked[0].c.name} wins!` : " It's a tie!";
  } else speech += `You got ${ranked[0].right} out of ${ranked[0].asked}, for ${ranked[0].points} points.`;
  for (const p of ranked) for (const m of p.milestones) speech += ' ' + m;
  const tricky = g.players.map(p => p.misses[0]).filter(Boolean);
  if (tricky.length) speech += ' Remember: ' + tricky.map(q => `${q.spoken} is ${q.answer}`).join('. ') + '.';
  if (g.usingVoice) speech += ' Say play again for another round.';
  await Voice.say(speech);
  if (!g.usingVoice) return;
  for (let k = 0; k < 2 && G === g && !$('results').hidden; k++) {
    setMic('listening');
    const r = await Voice.listen({ seconds: 8, commands: false, phrases: ['again', 'yes', 'yeah', 'play', 'another', 'no', 'done', 'quit'] });
    if (G !== g || $('results').hidden) return;
    if (r.type === 'phrase') { if (['no', 'done', 'quit'].includes(r.value)) { Voice.say('Good job, everyone!'); return; } start(); return; }
  }
}

function confetti() {
  const c = $('confetti'), ctx = c.getContext('2d');
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  const colors = ['#ffd23f', '#3ee08f', '#6c8cff', '#ff6b6b', '#ff8fd0'];
  const ps = Array.from({ length: 140 }, () => ({ x: Math.random(), d: Math.random() * 0.8, s: 0.25 + Math.random() * 0.25, w: 1 + Math.random() * 3, z: (6 + Math.random() * 7) * devicePixelRatio, r: 2 + Math.random() * 6, c: colors[Math.floor(Math.random() * 5)] }));
  const t0 = performance.now();
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    ctx.clearRect(0, 0, c.width, c.height);
    let alive = false;
    for (const p of ps) {
      const y = ((t - p.d) * p.s * c.height) - 20;
      if (y < -20 || y > c.height + 20) { if (y < -20) alive = true; continue; }
      alive = true;
      ctx.save(); ctx.translate(p.x * c.width + Math.sin(t * p.w) * 24 * devicePixelRatio, y); ctx.rotate(t * p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.z / 2, -p.z / 4, p.z, p.z / 2); ctx.restore();
    }
    if (alive && !$('results').hidden) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
  };
  frame();
}

// MARK: Stats

let statsOp = 'mul';
function renderStats() {
  segs($('statsSegs'), OPS.map(o => [o, OP[o].label]), statsOp, v => { statsOp = v; renderStats(); });
  $('statsHow').textContent = { mul: '', div: 'Each row divides by its number: the 56 in row ÷8 is 56 ÷ 8.', add: 'Each square is its row plus its column: 7 + 8 = 15.', sub: 'Each row takes away its number: the 15 in row −6 is 15 − 6.' }[statsOp];
  const op = statsOp, n = op === 'mul' || op === 'div' ? 12 : 10;
  const facts = ITEMS[op].filter(i => !i.isKind), kinds = ITEMS[op].filter(i => i.isKind);
  $('statsBody').innerHTML = family().map(p => {
    const m = memories[op][p.id] ?? {};
    const auto = facts.filter(f => Coach.mastery(m[f.key]) === 'automatic').length;
    let summary = 'Not played yet: the coach will figure out where to start.';
    if (Object.keys(m).length) {
      const s = skill(p.id, op);
      const st = groups(op).map(g => [g.label, Coach.strength(op, s, m, g)]);
      const strong = st.filter(x => x[1] >= 0.85).map(x => x[0]), working = st.filter(x => x[1] >= 0.55 && x[1] < 0.85).map(x => x[0]);
      summary = [strong.length ? '💪 Strong: ' + strong.join(' ') : '', working.length ? '🛠 Working on: ' + working.join(' ') : '', `⏱ ${s.clock}s clock`].filter(Boolean).join('  ·  ');
    }
    let grid = `<div class="grid" style="grid-template-columns: 2.2em repeat(${n}, 1fr)"><div class="h">${OP[op].symbol}</div>`;
    for (let c = 1; c <= n; c++) grid += `<div class="h">${op === 'div' || op === 'sub' ? '' : c}</div>`;
    for (let r = 1; r <= n; r++) {
      grid += `<div class="h">${op === 'div' ? '÷' + r : op === 'sub' ? '−' + r : r}</div>`;
      for (let c = 1; c <= n; c++) {
        const [text, key] = op === 'mul' ? [r * c, factKey(r, c)] : op === 'div' ? [r * c, `${r * c}/${r}`] : op === 'add' ? [r + c, `${Math.min(r, c)}+${Math.max(r, c)}`] : [r + c, `${r + c}-${r}`];
        grid += `<div class="m-${Coach.mastery(m[key])}">${text}</div>`;
      }
    }
    grid += '</div>';
    const kindChips = kinds.length ? `<div class="sectionTitle" style="font-size:12px">Bigger numbers</div><div class="chips">${kinds.map(k => `<span class="chip m-${Coach.mastery(m[k.key])}">${KIND_NAME[k.key]}</span>`).join('')}</div>` : '';
    return `<div class="card"><div class="sectionTitle">${p.avatar} ${esc(p.name)} — ${auto} of ${facts.length} facts automatic</div><div class="muted tiny">${summary}</div>${grid}${kindChips}</div>`;
  }).join('') || '<p class="muted center">Add a player and finish a round to see this.</p>';
}

// MARK: Wiring

$('btnStart').onclick = start;
$('btnStats').onclick = () => { statsOp = settings.mode; renderStats(); show('stats'); };
$('btnSettings').onclick = openSettings;
$('btnRepeat').onclick = () => interrupt({ type: 'command', value: 'repeat' });
$('btnSkip').onclick = () => interrupt({ type: 'skip' });
$('btnPause').onclick = pauseTapped;
$('btnEnd').onclick = quit;
$('btnAgain').onclick = start;
for (const id of ['btnHome1', 'btnHome2', 'btnHome3']) $(id).onclick = () => { if (G) { G.quit = true; Voice.stopListening({ type: 'nothing', why: 'quit' }); Voice.stopTalking(); } show('home'); renderHome(); };
buildKeypad();
// If the browser still blocks the voice, show a big button: one tap turns sound on.
Voice.whenBlocked(() => { $('soundBtn').hidden = false; });
$('soundBtn').onclick = () => { Voice.say('Sound is on!'); unlockSound(); };
Voice.setVoice(settings.voiceID, settings.voiceSpeed);
boardOp = settings.mode;
renderHome();
Cloud.watchUser(signedIn).catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
