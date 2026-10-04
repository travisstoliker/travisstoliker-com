// Talking and listening, using what Chrome (and Chromebooks) have built in.
// Speaking: speechSynthesis. Listening: SpeechRecognition (Chrome sends the audio to Google
// to turn it into text). If either is missing or blocked, the game switches to typing.
import { parse, interpret, soundsUnfinished, command, tokenize } from './numparse.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;

let voice = null, rate = 1;
export function voices() {
  if (!canSpeak) return [];
  return speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith('en'));
}
function bestVoice(id) {
  const vs = voices();
  if (id) { const v = vs.find(v => v.voiceURI === id); if (v) return v; }
  // Clearest first: natural/online voices, then Google's, then any US English.
  return vs.find(v => /natural|online/i.test(v.name) && /en-US/i.test(v.lang))
    ?? vs.find(v => /google us english/i.test(v.name))
    ?? vs.find(v => /en-US/i.test(v.lang)) ?? vs[0] ?? null;
}
export function setVoice(id, speed = 1) { voice = bestVoice(id); rate = speed; }
if (canSpeak) speechSynthesis.onvoiceschanged = () => { if (!voice) voice = bestVoice(); };

export function stopTalking() { if (canSpeak) speechSynthesis.cancel(); }

/** Say something and wait until it's finished (with a safety timeout so play never hangs). */
export function say(text, { slower = false } = {}) {
  return new Promise(resolve => {
    if (!canSpeak || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-US';
    u.rate = Math.min(1.2, Math.max(0.75, rate)) * (slower ? 0.92 : 1);
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(finish, 1500 + text.length * 90);
    u.onend = finish; u.onerror = finish;
    speechSynthesis.speak(u);
  });
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
