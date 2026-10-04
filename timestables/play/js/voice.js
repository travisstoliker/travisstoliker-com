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

/**
 * Browsers only allow sound that starts from a tap or click. Call this right inside a
 * click handler (before any waiting) so the voice can talk for the rest of the game.
 */
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

// Only stop if something is actually playing: an unneeded stop makes Safari drop the next line.
let clip = null;
function stopClip() { if (clip) { clip.pause(); clip.src = ''; clip = null; } }

/** iPhone's built-in voice stays silent, so play a real audio file through the loud speaker. */
function speakClip(text) {
  stopClip();
  const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=' + encodeURIComponent(text.slice(0, 180));
  return new Promise(resolve => {
    const a = new Audio(url);
    clip = a;
    // The speech file is refused when the request says it came from this site.
    a.referrerPolicy = 'no-referrer';
    a.preload = 'auto';
    let done = false;
    const finish = () => { if (done) return; done = true; if (clip === a) clip = null; resolve('ok'); };
    const safety = setTimeout(finish, 4000 + text.length * 80);
    a.onended = () => { clearTimeout(safety); finish(); };
    a.onerror = () => { clearTimeout(safety); finish(); };
    loudSpeaker();
    a.play().catch(() => { clearTimeout(safety); finish(); });
  });
}

export function stopTalking() { stopClip(); if (canSpeak && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel(); }

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
    // On iPhone, an Enhanced voice that isn't downloaded says nothing. Use a compact
    // built-in voice unless one was picked in Settings.
    // On iPhone, picking a voice (even a built-in one) often makes the line silent.
    // Leave the voice unset unless someone chose one in Settings.
    if (voice && !isIOS) u.voice = voice;
    else if (voice && isIOS && chosenId) u.voice = voice;
    u.lang = 'en-US';
    u.rate = isIOS ? 1 : Math.min(1.2, Math.max(0.75, rate)) * (slower ? 0.92 : 1);
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
    // Keep the utterance alive. Safari drops it if nothing else is holding it.
    pinned.push(u); if (pinned.length > 16) pinned.shift();
    loudSpeaker();
    try { if (!isIOS && speechSynthesis.paused) speechSynthesis.resume(); } catch {}
    speechSynthesis.speak(u);
  });
}

/** Say something and wait until it's finished (with safety timeouts so play never hangs). */
export async function say(text, { slower = false } = {}) {
  if (!text) return;
  if (isIOS) {
    loudSpeaker();
    for (const part of chunks(text)) await speakClip(part);
    return;
  }
  if (!canSpeak) return;
  if (!voice) voice = bestVoice(chosenId);
  const gesture = !!navigator.userActivation?.isActive;
  const busy = !!(speechSynthesis.speaking || speechSynthesis.pending);
  // iPhone only speaks a line that is queued during the tap, and it reports "speaking"
  // even when nothing is queued. Waiting here leaves the tap, so the phone stays silent.
  if (isIOS && gesture) {
    // Don't cancel. On iPhone a cancel in the same tap as the new line drops it.
    loudSpeaker();
    try { speechSynthesis.resume(); } catch {}
  } else if (busy) {
    speechSynthesis.cancel();
    await new Promise(r => setTimeout(r, 80));
  }
  for (const part of chunks(text)) {
    let r = await speakOne(part, slower);
    if (r === 'blocked') { onBlocked?.(); return; }
    if ((r === 'nostart' || r === 'error') && voice && !voice.localService) {
      avoidNetwork = true; voice = bestVoice(chosenId);
      speechSynthesis.cancel();
      await new Promise(wait => setTimeout(wait, 50));
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
