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
export async function signOut() { const { auth, A } = await load(); await A.signOut(auth); }

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
  return { roster: J(f.roster, []), knownNames: J(f.knownNames, {}), deleted: J(f.deleted, []), data };
}

export async function saveFamily(user, { roster, knownNames, deleted, data }) {
  const { db, S } = await load();
  const now = S.serverTimestamp();
  // merge: keep fields this page doesn't know about (like members another parent was invited as)
  await S.setDoc(S.doc(db, 'families', user.uid), { roster: JSON.stringify(roster), knownNames: JSON.stringify(knownNames),
    deleted: JSON.stringify(deleted), ownerEmail: user.email, updated: now }, { merge: true });
  for (const [op, d] of Object.entries(data)) {
    await S.setDoc(S.doc(db, 'families', user.uid, 'data', op), { memory: JSON.stringify(d.memory),
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
export const globalRowId = (user, playerId) => `${user.uid}_${playerId}`;

export async function saveGlobalRow(user, playerId, row) {
  const { db, S } = await load();
  await S.setDoc(S.doc(db, 'global', globalRowId(user, playerId)), { ...row, owner: user.uid, updated: S.serverTimestamp() });
}

export async function deleteGlobalRow(user, playerId) {
  const { db, S } = await load();
  await S.deleteDoc(S.doc(db, 'global', globalRowId(user, playerId)));
}

/**
 * Rows for one board: this week's (by week id), or all time for one mode (highest first). For
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
