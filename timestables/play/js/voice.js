// Talking and listening, using what Chrome (and Chromebooks) have built in.
// Speaking: speechSynthesis. Listening: SpeechRecognition (Chrome sends the audio to Google
// to turn it into text). If either is missing or blocked, the game switches to typing.
import { parse, interpret, soundsUnfinished, command, tokenize } from './numparse.js';

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

// iPhone: play recordings of the game's own voice (the iPhone app's "Sunny"), made in advance
// and served from this site (voice/). Plain audio plays even with the Silent switch on, and
// nothing is sent anywhere to make speech. One audio player is started inside the first tap;
// after that, iPhone lets the same player keep playing for the whole visit.
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let player = null, primed = false, manifest = null, playToken = 0;

function loadManifest() {
  manifest ??= fetch('voice/manifest.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifest;
}
if (isIOS) loadManifest();

/** Synchronous. Call inside the tap, before any waiting. */
function primeIosAudio() {
  loudSpeaker();
  if (!player) {
    player = document.createElement('audio');
    player.setAttribute('playsinline', '');
    player.playsInline = true;
    player.preload = 'auto';
  }
  if (!primed) {
    player.src = SILENT_WAV;
    try { const p = player.play(); primed = true; p?.catch?.(() => { primed = false; }); } catch { primed = false; }
  }
}

const OPS_RE = '(times|divided by|plus|minus)';
function sentences(text) {
  return (text.replace(/[’‘]/g, "'").match(/[^.!?]+[.!?]*/g) ?? [text]).map(x => x.trim()).filter(Boolean);
}

/** Turn what the game wants to say into recorded clips. Lines with names or tips that weren't
 *  recorded are left out (the screen shows them); questions and answers are always covered. */
function plan(text, m) {
  const ids = [], num = n => m[String(n)];
  const parts = sentences(text.replace(/^Hi [^!?.]*!/, 'Hi!'));
  for (let i = 0; i < parts.length; i++) {
    let hit = false;
    for (let k = 3; k >= 1 && !hit; k--) { // longest recorded run of sentences first
      const joined = parts.slice(i, i + k).join(' ');
      if (i + k <= parts.length && m[joined]) { ids.push(m[joined]); i += k - 1; hit = true; }
    }
    if (hit) continue;
    let s = parts[i].replace(/^[^,]{1,24}, what's /i, "What's ").replace(/^What is /, "What's ");
    if (m[s]) { ids.push(m[s]); continue; }
    if (/ is on fire!$/.test(s)) { ids.push(m["You're on fire! Three in a row!"]); if (parts[i + 1] === 'Three in a row!') i++; continue; }
    let x = s.match(new RegExp(`^(\\d+) ${OPS_RE} (\\d+)\\?$`)); // a repeated question
    if (x && m[`What's ${x[1]} ${x[2]} ${x[3]}?`]) { ids.push(m[`What's ${x[1]} ${x[2]} ${x[3]}?`]); continue; }
    if ((x = s.match(new RegExp(`^(?:What's )?(\\d+) ${OPS_RE} (\\d+)\\?$`)))) { ids.push(m["What's"], num(x[1]), m[x[2]], num(x[3])); continue; }
    if ((x = s.match(new RegExp(`^(\\d+) ${OPS_RE} (\\d+) is (\\d+)\\.$`)))) { ids.push(num(x[1]), m[x[2]], num(x[3]), m.is, num(x[4])); continue; }
    if ((x = s.match(/^I heard (\d+)\.$/))) { ids.push(m['I heard'], num(x[1])); continue; }
    if ((x = s.match(/^You got (\d+) out of (\d+)/))) { ids.push(m['You got'], num(x[1]), m['out of'], num(x[2])); continue; }
  }
  return ids.filter(Boolean);
}

function playClip(id, token) {
  return new Promise(resolve => {
    if (token !== playToken) return resolve(false);
    const el = player;
    let done = false;
    const finish = ok => { if (!done) { done = true; clearTimeout(timer); el.onended = el.onerror = null; resolve(ok); } };
    const timer = setTimeout(() => finish(true), 8000);
    el.onended = () => finish(true);
    el.onerror = () => finish(false);
    el.src = `voice/${id}.m4a`;
    el.playbackRate = Math.min(1.2, Math.max(0.8, rate));
    el.preservesPitch = true;
    try { const p = el.play(); p?.catch?.(() => finish(false)); } catch { finish(false); }
  });
}

/** Warm the cache for clips we're about to need (the next question), so there's no gap. */
export async function prefetch(text) {
  if (!isIOS) return;
  const m = await loadManifest();
  for (const id of plan(text, m)) fetch(`voice/${id}.m4a`).catch(() => {});
}

async function sayIOS(text) {
  primeIosAudio(); // still inside the tap when called from one
  const token = ++playToken;
  const ids = plan(text, await loadManifest());
  let any = false;
  for (const id of ids) {
    if (token !== playToken) break; // something newer started
    if (await playClip(id, token)) any = true;
  }
  return any || !ids.length;
}

export function stopTalking() {
  playToken++;
  try { if (player && primed) player.pause(); } catch {}
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
  if (isIOS) return (await sayIOS(text)) ? 'Done.' : 'No sound. Try again.';
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

