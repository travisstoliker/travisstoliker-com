// Google sign-in and saving, through Firebase (Google's app backend).
// - Each signed-in player's progress is saved to their Google account, so it follows them
//   to any Chromebook, computer or tablet.
// - Players with a school Google account (not gmail.com) also appear on their school's
//   leaderboard as first name + last initial ("Lane S."). Only people signed in with the
//   same school's accounts can see it.
import { firebaseConfig } from './firebase-config.js';

export const available = !!firebaseConfig;
const V = '10.12.2';
let fb = null; // { auth, db, mods }

const PUBLIC_DOMAINS = ['gmail.com', 'googlemail.com'];
export const schoolOf = user => {
  const d = user?.email?.split('@')[1]?.toLowerCase();
  return d && !PUBLIC_DOMAINS.includes(d) ? d : null;
};
/** "Lane Stoliker" → "Lane S." (no full names on leaderboards). */
export function shortName(user) {
  const parts = (user?.displayName || user?.email?.split('@')[0] || 'Player').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.` : parts[0];
}

async function load() {
  if (fb || !available) return fb;
  const [app, auth, store] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(firebaseConfig);
  fb = { auth: auth.getAuth(a), db: store.getFirestore(a), A: auth, S: store };
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
