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
function bestVoice(id) {
  const vs = voices();
  if (id) { const v = vs.find(v => v.voiceURI === id); if (v && !(avoidNetwork && !v.localService)) return v; }
  const usable = avoidNetwork ? vs.filter(v => v.localService) : vs;
  // Clearest first: natural voices, then Google's, then a built-in US English one.
  return usable.find(v => /natural/i.test(v.name) && /en-US/i.test(v.lang))
    ?? usable.find(v => /google us english/i.test(v.name))
    ?? usable.find(v => /^(samantha|alex|ava|zoe|allison)/i.test(v.name))
    ?? usable.find(v => /en-US/i.test(v.lang)) ?? usable[0] ?? null;
}
export function setVoice(id, speed = 1) { chosenId = id; voice = bestVoice(id); rate = speed; }
if (canSpeak) speechSynthesis.addEventListener?.('voiceschanged', () => { voice = bestVoice(chosenId); });

/** Called when the browser blocks sound until someone taps (the app shows a "tap for sound" button). */
let onBlocked = null;
export function whenBlocked(fn) { onBlocked = fn; }

/**
 * Browsers only allow sound that starts from a tap or click. Call this right inside a
 * click handler (before any waiting) so the voice can talk for the rest of the game.
 */
export function unlock() {
  // On iPhone a silent line doesn't count as "started by a tap", and it gets in the way of
  // the real first line. There, the app just says its first real line right inside the tap.
  if (!canSpeak || isIOS) return;
  try {
    if (speechSynthesis.paused) speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {}
}

// Only stop if something is actually playing: an unneeded stop makes Safari drop the next line.
export function stopTalking() { if (canSpeak && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel(); }

/** Split long speech into sentences: Chrome's online voices stop partway through long ones. */
function chunks(text) {
  const parts = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out = [];
  for (const p of parts) {
    if (out.length && (out.at(-1) + p).length < 160) out[out.length - 1] += p; else out.push(p);
  }
  return out.map(x => x.trim()).filter(Boolean);
}

function speakOne(text, slower) {
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    // On iPhone, use the phone's own voice unless one was picked in Settings: setting a voice
    // the phone hasn't downloaded makes it say nothing at all.
    if (voice && (!isIOS || chosenId)) u.voice = voice;
    u.lang = (isIOS && !chosenId) ? 'en-US' : voice?.lang ?? 'en-US';
    u.rate = Math.min(1.2, Math.max(0.75, rate)) * (slower ? 0.92 : 1);
    u.volume = 1;
    let started = false, done = false;
    const finish = r => { if (!done) { done = true; clearTimeout(noStart); clearTimeout(safety); resolve(r); } };
    // A voice that never starts (offline online-voice, glitch): use a built-in voice from now on.
    // (iPhone doesn't always report "started", so there we just wait for "finished".)
    const noStart = isIOS ? null : setTimeout(() => { if (!started) finish('nostart'); }, 2500);
    const safety = setTimeout(() => finish('timeout'), 2500 + text.length * 120);
    u.onstart = () => { started = true; };
    u.onend = () => finish('ok');
    u.onerror = e => finish(e.error === 'not-allowed' ? 'blocked' : e.error === 'interrupted' || e.error === 'canceled' ? 'stopped' : 'error');
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
  });
}

/** Say something and wait until it's finished (with safety timeouts so play never hangs). */
export async function say(text, { slower = false } = {}) {
  if (!canSpeak || !text) return;
  // Stopping and then speaking right away makes Safari (iPhone) drop the new line: give it a moment.
  if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); await new Promise(r => setTimeout(r, 150)); }
  for (const part of chunks(text)) {
    let r = await speakOne(part, slower);
    if (r === 'blocked') { onBlocked?.(); return; }
    if ((r === 'nostart' || r === 'error') && voice && !voice.localService) {
      avoidNetwork = true; voice = bestVoice(chosenId);
      speechSynthesis.cancel();
      r = await speakOne(part, slower);
    }
    if (r === 'stopped') return;
  }
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
