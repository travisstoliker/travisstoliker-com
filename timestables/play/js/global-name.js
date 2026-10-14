// The global leaderboard's names: first name + last initial ("Lane S."), letters only, and never a
// blocked word. The iPhone and Android apps use the same lists, and the database rules run the
// same check again (web/firestore.rules in the app's repo), so a name that slips past one copy of
// the app still can't be saved.

/** Blocked anywhere in the name. */
export const STRONG = ['fuck', 'shit', 'bitch', 'cunt', 'cock', 'pussy', 'penis', 'vagina', 'slut', 'whore', 'nigg', 'fagg',
  'rape', 'porn', 'nazi', 'hitler', 'dildo', 'boob', 'horny', 'wank', 'twat', 'bollock', 'jizz', 'semen', 'molest', 'pedo',
  'incest', 'nude', 'naked', 'kkk'];
/** Blocked as a whole first name (or one half of a hyphenated one). */
export const EXACT = ['ass', 'arse', 'dick', 'cum', 'sex', 'sexy', 'poop', 'poo', 'butt', 'butthead', 'fart', 'pee', 'piss', 'crap',
  'damn', 'hell', 'anal', 'anus', 'hoe', 'ho', 'tit', 'tits', 'titty', 'kill', 'die', 'dead', 'stupid', 'dumb', 'idiot', 'loser',
  'ugly', 'fat', 'moron', 'retard', 'sucks', 'hate', 'bastard', 'bum', 'turd', 'weed', 'drugs', 'admin', 'moderator'];

const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
// Numbers and symbols standing in for letters ("sh1t", "@ss"), for the check only.
const unleet = s => s.toLowerCase().replace(/[0@4$1!3757]/g, c => ({ 0: 'o', '@': 'a', 4: 'a', $: 's', 1: 'i', '!': 'i', 3: 'e', 7: 't', 5: 's' }[c]));

/** True if a name (or what someone typed) must not go on the global leaderboard. */
export function isBlocked(text) {
  const raw = unleet(plain(text)).replace(/[^a-z\s-]/g, '');
  const squashed = raw.replace(/[\s-]/g, '');
  if (STRONG.some(w => squashed.includes(w))) return true;
  return raw.split(/[\s-]+/).filter(Boolean).some(w => EXACT.includes(w));
}

/**
 * "Lane" + "S" → "Lane S.". Uses the first word of the player's name, letters A to Z only
 * (accents dropped: "Zoë" → "Zoe"), up to 12 letters, and one hyphen ("Mary-Kate").
 * Returns null if there's no usable name or initial, or the name is blocked.
 */
export function globalName(name, initial) {
  const firstWord = plain(name).trim().split(/\s+/)[0] ?? '';
  if (isBlocked(firstWord)) return null;
  const parts = firstWord.replace(/[^A-Za-z-]/g, '').split('-').filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase() + w.slice(1, 12).toLowerCase());
  if (parts.length === 2 && parts[1].length < 2) parts.pop();
  const ini = plain(initial).replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase();
  if (!parts.length || !ini) return null;
  const n = `${parts.join('-')} ${ini}.`;
  return isBlocked(n) ? null : n;
}
