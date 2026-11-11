// Google sign-in and saving, through Firebase (Google's app backend).
// - Each signed-in player's progress is saved to their Google account, so it follows them
//   to any Chromebook, computer or tablet.
// - Players with a school Google account (not gmail.com) also appear on their school's
//   leaderboard as first name + last initial ("Lane S."). Only people signed in with the
//   same school's accounts can see it.
// - A parent signed in with the family account can put a player on the global leaderboard
//   (opt-in, per player): "Lane S.", their animal and points. Anyone signed in can see it.
import { firebaseConfig } from './firebase-config.js';

export const available = !!firebaseConfig;
const V = '10.12.2';
let fb = null; // { auth, db, mods }
// Tests only: ?firebaseEmulator=127.0.0.1 talks to Firebase's local emulator (made-up accounts,
// nothing real). It only ever points this browser at its own computer.
const EMU = (() => { try { return new URLSearchParams(location.search).get('firebaseEmulator'); } catch { return null; } })();

// Personal email domains never get a shared school leaderboard (the database rules agree).
const PUBLIC_DOMAINS = ['gmail.com', 'googlemail.com', 'privaterelay.appleid.com', 'icloud.com', 'me.com', 'mac.com'];
export const schoolOf = user => {
  const d = user?.email?.split('@')[1]?.toLowerCase();
  return d && !PUBLIC_DOMAINS.includes(d) ? d : null;
};
/** "Lane Stoliker" → "Lane S." (no full names on leaderboards). */
export function shortName(user) {
  const parts = (user?.displayName || user?.email?.split('@')[0] || 'Player').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.` : parts[0];
}

// One shared load: sign-in can start while the page's own start-up load is still running, and
// two loads at once would start Firebase twice (the second fails and its caller hears nothing).
let loading = null;
function load() {
  if (fb || !available) return Promise.resolve(fb);
  return (loading ??= loadOnce().catch(e => { loading = null; throw e; }));
}
async function loadOnce() {
  const [app, auth, store] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(EMU ? { ...firebaseConfig, projectId: 'demo-ttrt' } : firebaseConfig);
  fb = { auth: auth.getAuth(a), db: store.getFirestore(a), A: auth, S: store };
  if (EMU) {
    auth.connectAuthEmulator(fb.auth, `http://${EMU}:9099`, { disableWarnings: true });
    store.connectFirestoreEmulator(fb.db, EMU, 8080);
  }
  return fb;
}

export async function watchUser(cb) {
  if (!available) return cb(null);
  const { auth, A } = await load();
  A.onAuthStateChanged(auth, cb);
}
export async function signIn() {
  const { auth, A } = await load();
  const p = new A.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return (await A.signInWithPopup(auth, p)).user;
}
/** Tests only (emulator): sign in as a made-up Google account. */
export async function testSignIn(email, name) {
  if (!EMU) throw new Error('emulator only');
  const { auth, A } = await load();
  const cred = A.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name }));
  return (await A.signInWithCredential(auth, cred)).user;
}
export async function currentUser() { const { auth } = await load(); return auth.currentUser; }
export async function signOut() { const { auth, A } = await load(); await A.signOut(auth); }

// MARK: Joining a family with a code (from the app's Settings > Add another device)
// The browser gets its own sign-in-free account, and the family lets that account in
// (families/<family>/members/<account>). Nobody signs in here.
const JOINED = 'ttrt-joined-family';
export const joinedFamily = () => { try { return localStorage.getItem(JOINED); } catch { return null; } };
/** Whose family this browser saves to: the family it joined with a code, or its own account's. */
export const familyId = user => (user?.isAnonymous ? joinedFamily() : user?.uid) ?? null;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', CODE_MINUTES = 15;
export const codeMinutes = CODE_MINUTES;
/** "k7pq 4xmr" or "K7PQ-4XMR" → "K7PQ4XMR" (null if it can't be a code). */
export function normalizeCode(typed) {
  const c = String(typed ?? '').toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? c : null;
}
export const showCode = c => `${c.slice(0, 4)}-${c.slice(4)}`;
class CodeError extends Error {}

/** A code another device types to join this family (15 minutes). */
export async function makeJoinCode(user) {
  const { db, S } = await load();
  for (let i = 0; i < 3; i++) {
    const r = crypto.getRandomValues(new Uint32Array(8));
    const code = Array.from(r, n => CODE_LETTERS[n % CODE_LETTERS.length]).join('');
    try {
      // A code that already exists would be an update, which the rules refuse: then try another.
      await S.setDoc(S.doc(db, 'joinCodes', code), { family: familyId(user), by: user.uid,
        expires: S.Timestamp.fromMillis(Date.now() + CODE_MINUTES * 60e3) });
      return code;
    } catch (e) { if (e?.code !== 'permission-denied') throw e; }
  }
  throw new CodeError('Couldn’t make a code. Check the internet connection and try again.');
}

/** Join the family a code belongs to. Returns the family's id. */
export async function joinWithCode(typed) {
  const code = normalizeCode(typed);
  if (!code) throw new CodeError('A code has 8 letters and numbers, like K7PQ-4XMR.');
  const { auth, A, db, S } = await load();
  const me = (await A.signInAnonymously(auth)).user;
  try {
    const c = await S.getDoc(S.doc(db, 'joinCodes', code));
    if (!c.exists() || typeof c.data().family !== 'string') throw new CodeError('That code didn’t work. Check it, or make a new one on the other device.');
    if (c.data().expires?.toMillis?.() < Date.now()) throw new CodeError(`That code ran out (codes last ${CODE_MINUTES} minutes). Make a new one on the other device.`);
    const fid = c.data().family;
    await S.setDoc(S.doc(db, 'families', fid, 'members', me.uid), { code, joined: S.Timestamp.now(), device: 'Web browser' });
    try { localStorage.setItem(JOINED, fid); } catch {}
    return fid;
  } catch (e) {
    await me.delete().catch(() => A.signOut(auth)); // nothing half-joined is left behind
    if (e instanceof CodeError) throw e;
    if (e?.code === 'permission-denied') throw new CodeError(`That code didn’t work. Codes last ${CODE_MINUTES} minutes; make a new one on the other device.`);
    throw new CodeError('Couldn’t connect. Check the internet connection and try again.');
  }
}

/** This browser stops saving to the family: it's let out and its sign-in-free account deleted. */
export async function leaveFamily(user) {
  const { auth, A, db, S } = await load();
  const fid = joinedFamily();
  if (fid) await S.deleteDoc(S.doc(db, 'families', fid, 'members', user.uid)).catch(() => {});
  try { localStorage.removeItem(JOINED); } catch {}
  await user.delete().catch(() => A.signOut(auth));
}

/** Everything saved for this account: { profile, progress: { "memory.div": {...}, ... } }. */
export async function loadAccount(uid) {
  const { db, S } = await load();
  const snap = await S.getDoc(S.doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  const progress = {};
  for (const [k, v] of Object.entries(d.progress ?? {})) { try { progress[k] = JSON.parse(v); } catch {} }
  return { profile: d.profile ?? {}, progress };
}

export async function saveAccount(uid, profile, progress) {
  const { db, S } = await load();
  const enc = Object.fromEntries(Object.entries(progress).map(([k, v]) => [k, JSON.stringify(v)]));
  await S.setDoc(S.doc(db, 'users', uid), { profile, progress: enc, updated: S.serverTimestamp() });
}

/** The family saved under this account (a parent's): roster + everyone's progress, or null. */
export async function loadFamily(uid) {
  const { db, S } = await load();
  const fam = await S.getDoc(S.doc(db, 'families', uid));
  if (!fam.exists()) return null;
  const J = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const f = fam.data(), data = {};
  for (const op of ['mul', 'div', 'add', 'sub', 'mix']) { // mix: Mix rounds' results only
    const d = await S.getDoc(S.doc(db, 'families', uid, 'data', op));
    const x = d.exists() ? d.data() : {};
    data[op] = { memory: J(x.memory, {}), skills: J(x.skills, {}), results: J(x.results, []) };
  }
  return { roster: J(f.roster, []), knownNames: J(f.knownNames, {}), deleted: J(f.deleted, []), ownerEmail: f.ownerEmail ?? null, data };
}

export async function saveFamily(user, { roster, knownNames, deleted, data }) {
  const { db, S } = await load();
  const now = S.serverTimestamp();
  // merge: keep fields this page doesn't know about (like members another parent was invited as)
  const fid = familyId(user);
  // A browser that joined with a code has no email: it keeps the owner's.
  await S.setDoc(S.doc(db, 'families', fid), { roster: JSON.stringify(roster), knownNames: JSON.stringify(knownNames),
    deleted: JSON.stringify(deleted), ...(user.isAnonymous ? {} : { ownerEmail: user.email }), updated: now }, { merge: true });
  for (const [op, d] of Object.entries(data)) {
    await S.setDoc(S.doc(db, 'families', fid, 'data', op), { memory: JSON.stringify(d.memory),
      skills: JSON.stringify(d.skills), results: JSON.stringify(d.results), updated: now });
  }
}

/** This player's row on their school's leaderboard. */
export async function saveBoardRow(user, row) {
  const school = schoolOf(user);
  if (!school) return;
  const { db, S } = await load();
  await S.setDoc(S.doc(db, 'boards', school, 'players', user.uid), { ...row, updated: S.serverTimestamp() });
}

export async function loadBoard(user) {
  const school = schoolOf(user);
  if (!school) return [];
  const { db, S } = await load();
  const snap = await S.getDocs(S.collection(db, 'boards', school, 'players'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// MARK: Global leaderboard (opt-in per player, by a parent signed in with the family account)

/** "<family account id>_<player id>": the database rules let only that account write it. */
export const globalRowId = (user, playerId) => `${familyId(user)}_${playerId}`;

export async function saveGlobalRow(user, playerId, row) {
  const { db, S } = await load();
  await S.setDoc(S.doc(db, 'global', globalRowId(user, playerId)), { ...row, owner: familyId(user), updated: S.serverTimestamp() });
}

export async function deleteGlobalRow(user, playerId) {
  const { db, S } = await load();
  await S.deleteDoc(S.doc(db, 'global', globalRowId(user, playerId)));
}

/** This family's own rows (the server's word on who is on the world leaderboard). */
export async function ownGlobalRows(user) {
  const { db, S } = await load();
  const snap = await S.getDocs(S.query(S.collection(db, 'global'), S.where('owner', '==', familyId(user))));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Rows for one board:this week's (by week id), or all time for one mode (highest first). For
 * "All modes", the most recently updated rows; the page adds their modes up.
 */
export async function loadGlobal(op, weekId) {
  const { db, S } = await load();
  const col = S.collection(db, 'global');
  const q = weekId ? S.query(col, S.where('week.id', '==', weekId), S.limit(300))
    : op ? S.query(col, S.orderBy(`points.${op}`, 'desc'), S.limit(100))
    : S.query(col, S.orderBy('updated', 'desc'), S.limit(300));
  const snap = await S.getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** "Report" on a row: Travis reads these in the Firebase console and takes the row down. */
export async function reportRow(user, row) {
  const { db, S } = await load();
  await S.addDoc(S.collection(db, 'reports'), { row: row.id, name: String(row.name ?? '').slice(0, 40), reason: 'name', reporter: user.uid, at: S.serverTimestamp() });
}
