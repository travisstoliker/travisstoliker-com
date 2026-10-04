// Talking and listening, using what Chrome (and Chromebooks) have built in.
// Speaking: speechSynthesis. Listening: SpeechRecognition (Chrome sends the audio to Google
// to turn it into text). If either is missing or blocked, the game switches to typing.
import { parse, interpret, soundsUnfinished, command, tokenize } from './numparse.js';
import SamJs from './sam.js?v=9';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;
/** iPhone and iPad (every browser there, Chrome included, uses Safari's engine). */
export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let voice = null, rate = 1, chosenId = null, avoidNetwork = false;
export function voices() {
  if (!canSpeak) return [];
  return speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith('en'));
}
function compact(v) { return v.localService && !/enhanced|premium|siri/i.test(v.name); }
function bestVoice(id) {
  const vs = voices();
  if (id) { const v = vs.find(v => v.voiceURI === id); if (v && !(avoidNetwork && !v.localService)) return v; }
  const local = vs.filter(compact);
  // Built-in voices first. Chrome's Natural and Google voices, and iPhone "Enhanced"
  // voices that aren't downloaded, can start and still be silent.
  return local.find(v => /^(samantha|alex|ava|zoe|allison|daniel|fred|victoria)/i.test(v.name))
    ?? local.find(v => /en-US/i.test(v.lang))
    ?? local[0]
    ?? vs.find(v => v.localService && /en-US/i.test(v.lang) && !/enhanced|premium/i.test(v.name))
    ?? vs.find(v => /en-US/i.test(v.lang))
    ?? vs[0]
    ?? null;
}
export function setVoice(id, speed = 1) { chosenId = id; voice = bestVoice(id); rate = speed; }
if (canSpeak) speechSynthesis.addEventListener?.('voiceschanged', () => { voice = bestVoice(chosenId); });

/** Called when the browser blocks sound until someone taps (the app shows a "tap for sound" button). */
let onBlocked = null;
export function whenBlocked(fn) { onBlocked = fn; }

/** Put speech on the loud speaker. Otherwise iPhone plays beeps out loud and the voice into silence. */
export function loudSpeaker() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
}
export function unlock() {
  if (!canSpeak) return;
  loudSpeaker();
  // Resume only. A silent line here gets cancelled by the next one, and Chrome (and Safari on
  // iPhone) then drop that line too. The game instead says its first real line inside the tap.
  try { speechSynthesis.resume(); } catch {}
}

// iPhone will not start new audio after the tap's call stack ends unless a node
// was already started during the tap. The keeper stays on for the whole session.
let voiceCtx = null, voiceNode = null, keeper = null, htmlAudio = null, htmlStarted = false;
const clipCache = new Map();
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let sam;

function voiceAudio() {
  voiceCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (voiceCtx.state !== 'running') voiceCtx.resume();
  return voiceCtx;
}

/** Synchronous. Call before any await, inside the tap. */
function primeIosAudio() {
  loudSpeaker();
  const ctx = voiceAudio();
  if (!keeper) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.frequency.value = 220;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      keeper = osc;
    } catch {
      const rate = ctx.sampleRate || 22050;
      const buf = ctx.createBuffer(1, rate, rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (i & 1) ? 0.0001 : -0.0001;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      keeper = src;
    }
  }
  if (!htmlAudio) {
    htmlAudio = document.createElement('audio');
    htmlAudio.setAttribute('playsinline', '');
    htmlAudio.setAttribute('webkit-playsinline', '');
    htmlAudio.playsInline = true;
    htmlAudio.preload = 'auto';
    htmlAudio.src = SILENT_WAV;
  }
  if (!htmlStarted && (!htmlAudio.src || htmlAudio.src.startsWith('data:'))) {
    try {
      const played = htmlAudio.play();
      htmlStarted = true;
      if (played && played.catch) played.catch(() => { htmlStarted = false; });
    } catch { htmlStarted = false; }
  }
}

function stopClip() {
  try { voiceNode?.stop(); } catch {}
  voiceNode = null;
  if (htmlAudio && htmlAudio.src.startsWith('blob:')) {
    try { htmlAudio.pause(); } catch {}
  }
}

function playBuffer(ctx, audio) {
  stopClip();
  const node = ctx.createBufferSource();
  node.buffer = audio;
  node.connect(ctx.destination);
  voiceNode = node;
  try { node.start(); } catch { return Promise.resolve(false); }
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; clearTimeout(t); resolve(ok); } };
    const t = setTimeout(() => finish(true), Math.ceil((audio.duration || 1) * 1000) + 250);
    node.onended = () => finish(true);
  });
}

function playElementBytes(bytes, type) {
  if (!htmlAudio) return Promise.resolve(false);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const el = htmlAudio;
  return new Promise(resolve => {
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.onended = null;
      el.onerror = null;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(true), 20000);
    el.onended = () => finish(true);
    el.onerror = () => finish(false);
    el.src = url;
    try {
      const played = el.play();
      if (played && played.catch) played.catch(() => finish(false));
    } catch { finish(false); }
  });
}

function speakSam(ctx, text) {
  try {
    sam ??= new SamJs();
    const clean = text.replace(/[^A-Za-z0-9 .,!?'-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return Promise.resolve(false);
    const pcm = sam.buf8(clean);
    if (!pcm || !pcm.length) return Promise.resolve(false);
    const audio = ctx.createBuffer(1, pcm.length, 22050);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] - 128) / 256;
    return playBuffer(ctx, audio);
  } catch { return Promise.resolve(false); }
}

const ACCENTS = [
  ['en', 'US'],
  ['en-GB', 'British'],
  ['en-AU', 'Australian'],
  ['en-IN', 'Indian'],
];
let accentMem = 'en';

function readStoredAccent() {
  try {
    const s = JSON.parse(localStorage.getItem('ttrt.settings') || '{}');
    if (s && ACCENTS.some(([code]) => code === s.iosAccent)) return s.iosAccent;
  } catch {}
  return 'en';
}

function iosAccent() { return accentMem; }

function writeAccent(code) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('ttrt.settings') || '{}') || {}; } catch { s = {}; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  s.iosAccent = code;
  try { localStorage.setItem('ttrt.settings', JSON.stringify(s)); } catch {}
}

if (isIOS) {
  accentMem = readStoredAccent();
  const origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    if (key === 'ttrt.settings') {
      try {
        const next = JSON.parse(value);
        if (next && typeof next === 'object' && !Array.isArray(next)) {
          next.iosAccent = accentMem;
          value = JSON.stringify(next);
        }
      } catch {}
    }
    return origSet(key, value);
  };
}

/** iPhone's built-in voice stays silent. Ask our own /tts address, which the service worker fills with a normal voice. */
async function speakClip(text) {
  const ctx = voiceAudio();
  const tl = iosAccent();
  const q = text.slice(0, 180);
  const key = tl + '\n' + q;
  let audio = clipCache.get(key);
  if (!audio) {
    const url = new URL('tts?tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(q), location.href);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return false;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength <= 128) return false;
      audio = await ctx.decodeAudioData(bytes.slice(0));
      clipCache.set(key, audio);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!audio) return false;
  return playBuffer(ctx, audio);
}

function setupIosVoices() {
  if (!isIOS || typeof document === 'undefined') return;
  const sel = document.getElementById('voiceSel');
  if (sel) sel.hidden = true;
  let box = document.getElementById('iosVoices');
  if (!box) {
    box = document.createElement('div');
    box.id = 'iosVoices';
    box.className = 'segs';
    if (sel && sel.parentNode) sel.parentNode.insertBefore(box, sel);
  }
  box.hidden = false;
  const paint = () => {
    box.replaceChildren();
    const cur = iosAccent();
    for (const [code, label] of ACCENTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (code === cur) b.className = 'on';
      b.addEventListener('click', () => {
        accentMem = code;
        writeAccent(code);
        paint();
      });
      box.append(b);
    }
  };
  paint();
}

export function stopTalking() {
  stopClip();
  if (canSpeak && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}

/** Split long speech into sentences: Chrome's online voices stop partway through long ones. */
function chunks(text) {
  const parts = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out = [];
  for (const p of parts) {
    if (out.length && (out.at(-1) + p).length < 160) out[out.length - 1] += p; else out.push(p);
  }
  return out.map(x => x.trim()).filter(Boolean);
}

const pinned = [];
function speakOne(text, slower) {
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice && !isIOS) u.voice = voice;
    else if (voice && isIOS && chosenId) u.voice = voice;
    u.lang = 'en-US';
    u.rate = isIOS ? 1 : Math.min(1.2, Math.max(0.75, rate)) * (slower ? 0.92 : 1);
    u.volume = 1;
    let started = false, done = false;
    const finish = r => { if (!done) { done = true; clearTimeout(noStart); clearTimeout(safety); resolve(r); } };
    const noStart = isIOS ? null : setTimeout(() => { if (!started) finish('nostart'); }, 2500);
    const safety = setTimeout(() => finish('timeout'), 2500 + text.length * 120);
    u.onstart = () => { started = true; };
    u.onend = () => finish('ok');
    u.onerror = e => finish(e.error === 'not-allowed' ? 'blocked' : e.error === 'interrupted' || e.error === 'canceled' ? 'stopped' : 'error');
    pinned.push(u); if (pinned.length > 16) pinned.shift();
    loudSpeaker();
    try { if (!isIOS && speechSynthesis.paused) speechSynthesis.resume(); } catch {}
    speechSynthesis.speak(u);
  });
}

/** Say something and wait until it's finished. Resolves "Done." or "No sound. Try again." */
export async function say(text, { slower = false } = {}) {
  if (!text) return 'Done.';
  if (isIOS) {
    primeIosAudio();
    let any = false;
    for (const part of chunks(text)) {
      if (await speakClip(part)) any = true;
    }
    return any ? 'Done.' : 'No sound. Try again.';
  }
  if (!canSpeak) return 'No sound. Try again.';
  if (!voice) voice = bestVoice(chosenId);
  const gesture = !!navigator.userActivation?.isActive;
  const busy = !!(speechSynthesis.speaking || speechSynthesis.pending);
  if (isIOS && gesture) {
    loudSpeaker();
    try { speechSynthesis.resume(); } catch {}
  } else if (busy) {
    speechSynthesis.cancel();
    await new Promise(r => setTimeout(r, 80));
  }
  for (const part of chunks(text)) {
    let r = await speakOne(part, slower);
    if (r === 'blocked') { onBlocked?.(); return 'No sound. Try again.'; }
    if ((r === 'nostart' || r === 'error') && voice && !voice.localService) {
      avoidNetwork = true; voice = bestVoice(chosenId);
      speechSynthesis.cancel();
      await new Promise(wait => setTimeout(wait, 50));
      r = await speakOne(part, slower);
    }
    if (r === 'stopped') return 'Done.';
    if (r !== 'ok' && r !== 'timeout') return 'No sound. Try again.';
  }
  return 'Done.';
}

let active = null;
export const isListening = () => !!active;

/** Listen for one answer. Resolves {type:'number'|'command'|'phrase'|'nothing', ...}. */
export function listen({ seconds, expect = null, commands = true, phrases = [], max = 144, onHeard }) {
  stopListening({ type: 'nothing', why: 'quit' });
  return new Promise(resolve => {
    if (!SR) return resolve({ type: 'nothing', why: 'unavailable' });
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 3;
    let lastText = '', settle = null, finished = false;
    const finish = r => {
      if (finished) return; finished = true;
      clearTimeout(settle); clearTimeout(timeout); active = null;
      try { rec.abort(); } catch {}
      resolve(r);
    };
    active = { finish };
    const timeout = setTimeout(() => {
      const n = interpret(lastText, expect, max);
      finish(n !== null ? { type: 'number', value: n, heard: lastText } : { type: 'nothing', why: 'timeout', heard: lastText });
    }, seconds * 1000);
    rec.onresult = e => {
      const res = e.results[e.results.length - 1];
      const texts = Array.from(res).map(a => a.transcript.trim());
      const text = texts[0] ?? '';
      if (text) lastText = text;
      onHeard?.(text);
      const words = new Set(tokenize(text));
      const p = phrases.find(w => words.has(w));
      if (p) return finish({ type: 'phrase', value: p });
      const n = parse(text);
      if (n === null) {
        const c = commands && command(text);
        if (c) finish({ type: 'command', value: c, heard: text });
        return;
      }
      let value = interpret(text, expect, max) ?? n;
      if (expect !== null && value !== expect && texts.slice(0, 3).some(t => interpret(t, expect, max) === expect)) value = expect;
      if (res.isFinal) return finish({ type: 'number', value, heard: text });
      clearTimeout(settle);
      const wait = value === expect ? 300 : soundsUnfinished(text, value, expect) ? 2200 : value % 10 === 0 ? 1300 : 800;
      settle = setTimeout(() => finish({ type: 'number', value, heard: text }), wait);
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') finish({ type: 'nothing', why: 'unavailable' });
      else if (e.error === 'audio-capture') finish({ type: 'nothing', why: 'unavailable' });
      // 'no-speech' and 'network' blips: onend restarts listening below
    };
    rec.onend = () => { if (!finished) { try { rec.start(); } catch { finish({ type: 'nothing', why: 'timeout', heard: lastText }); } } };
    try { rec.start(); } catch { finish({ type: 'nothing', why: 'unavailable' }); }
  });
}
export function stopListening(r) { active?.finish(r); }

setupIosVoices();
