// Direct Instruction Reading: lesson content.
// Original sequence and word lists, written for this app. Principles follow
// Direct Instruction: one new thing at a time, sounds before letter names,
// continuous sounds early, look-alike letters kept apart, every word made
// only of sounds already taught, lots of review.

// How each sound is said. hold: true = keep it going ("mmm"),
// false = quick sound, no "uh" on the end.
export const SOUNDS = {
  m:   { say: 'mmm',  hold: true,  as: 'man' },
  a:   { say: 'aaa',  hold: true,  as: 'at' },
  s:   { say: 'sss',  hold: true,  as: 'sun' },
  t:   { say: 't',    hold: false, as: 'top' },
  r:   { say: 'rrr',  hold: true,  as: 'run' },
  f:   { say: 'fff',  hold: true,  as: 'fan' },
  i:   { say: 'iii',  hold: true,  as: 'it' },
  n:   { say: 'nnn',  hold: true,  as: 'nap' },
  d:   { say: 'd',    hold: false, as: 'dog' },
  o:   { say: 'ooo',  hold: true,  as: 'on' },
  c:   { say: 'k',    hold: false, as: 'cat' },
  h:   { say: 'h',    hold: false, as: 'hat' },
  g:   { say: 'g',    hold: false, as: 'go' },
  l:   { say: 'lll',  hold: true,  as: 'lip' },
  p:   { say: 'p',    hold: false, as: 'pig' },
  e:   { say: 'eee',  hold: true,  as: 'egg' },
  u:   { say: 'uuu',  hold: true,  as: 'up' },
  b:   { say: 'b',    hold: false, as: 'bus' },
  sh:  { say: 'shhh', hold: true,  as: 'ship' },
  th:  { say: 'ththth', hold: true, as: 'this' },
  w:   { say: 'www',  hold: true,  as: 'wet' },
  ch:  { say: 'ch',   hold: false, as: 'chin' },
  k:   { say: 'k',    hold: false, as: 'kid' },
  ee:  { say: 'eeee', hold: true,  as: 'see' },
  ck:  { say: 'k',    hold: false, as: 'duck' },
  ing: { say: 'ing',  hold: true,  as: 'sing' },
  v:   { say: 'vvv',  hold: true,  as: 'van' },
  j:   { say: 'j',    hold: false, as: 'jam' },
  y:   { say: 'y',    hold: false, as: 'yes' },
  z:   { say: 'zzz',  hold: true,  as: 'zip' },
  x:   { say: 'ks',   hold: false, as: 'box' },
  qu:  { say: 'kw',   hold: false, as: 'quit' },
  oo:  { say: 'oooo', hold: true,  as: 'moon' },
  ar:  { say: 'ar',   hold: true,  as: 'car' },
  er:  { say: 'er',   hold: true,  as: 'her' },
};

// Sound units the word display groups together (longest first).
const UNITS = ['ing', 'sh', 'th', 'ch', 'ck', 'ee', 'qu', 'oo', 'ar', 'er',
  'll', 'ss', 'ff', 'zz', 'tt', 'dd'];
const DOUBLE = { ll: 'l', ss: 's', ff: 'f', zz: 'z', tt: 't', dd: 'd' };

// Split a word into the sound units a child reads, e.g. "ship" -> sh,i,p.
export function units(word) {
  const w = word.toLowerCase();
  const out = [];
  let i = 0;
  while (i < w.length) {
    const u = UNITS.find(u => w.startsWith(u, i)) || w[i];
    out.push(u);
    i += u.length;
  }
  return out;
}
export const soundOf = u => DOUBLE[u] || u;

// "Say it slow" form for the grown-up: hold the long sounds, keep the
// quick ones quick. "mat" -> "mmmaaat".
export function slow(word) {
  return units(word).map(u => {
    const s = SOUNDS[soundOf(u)];
    return s ? s.say : u;
  }).join('');
}

// Words that don't sound out the regular way yet. Taught whole, with a note
// for the grown-up.
export const TRICKY = {
  a:    'Said "uh" when it is a word by itself.',
  is:   'The s says "zzz" here: "iiizzz".',
  his:  'The s says "zzz" here.',
  has:  'The s says "zzz" here.',
  as:   'The s says "zzz" here.',
  the:  'Said "thuh" (or "thee" before a vowel).',
  was:  'Said "wuz".',
  to:   'Said "too".',
  i:    'A capital I by itself means me. Said like its name.',
  he:   'The e says its name: "heee".',
  me:   'The e says its name: "meee".',
  we:   'The e says its name: "weee".',
  she:  'The e says its name: "sheee".',
  be:   'The e says its name: "beee".',
  said: 'Said "sed".',
  you:  'Said "yoo".',
  of:   'Said "uv".',
};

// The lessons. new = new sound (or null), tricky = new tricky words,
// hear = words for oral "say it fast" (any word, no reading needed),
// read = words to sound out, story = sentences, q = a question about the
// story for the grown-up to ask, with the answer.
export const LESSONS = [
  { new: 'm', hear: ['am', 'man', 'mat', 'map'], read: [] },
  { new: 'a', hear: ['sat', 'mad', 'fan', 'rat'], read: ['am'] },
  { new: 's', hear: ['sam', 'mast', 'sit', 'sun'], read: ['am', 'mass'] },
  { new: 't', hear: ['at', 'tam', 'mitt', 'fast'], read: ['at', 'mat', 'sat', 'mast', 'tam'] },
  { new: 'r', tricky: ['a'], hear: ['rat', 'ram', 'rust', 'trim'], read: ['rat', 'ram', 'rats', 'mast', 'tram'],
    story: ['a rat sat.'], q: ['What sat?', 'A rat.'] },
  { new: 'f', hear: ['fat', 'fast', 'raft', 'fit'], read: ['fat', 'fast', 'raft', 'mats', 'rafts'],
    story: ['a fat rat sat.'], q: ['Was the rat fat?', 'Yes.'] },
  { new: 'i', tricky: ['is'], hear: ['it', 'sit', 'fist', 'mist'], read: ['it', 'sit', 'fit', 'rim', 'fist', 'mist', 'sift'],
    story: ['it is a fat rat.', 'a rat sat.'], q: ['What is fat?', 'The rat.'] },
  { new: 'n', tricky: ['the'], hear: ['ant', 'mint', 'tin', 'nap'], read: ['an', 'man', 'ran', 'fan', 'tin', 'in', 'ant', 'mint'],
    story: ['the man ran.', 'the rat is in the tin.'], q: ['Where is the rat?', 'In the tin.'] },
  { new: 'd', hear: ['dad', 'sand', 'did', 'dim'], read: ['dad', 'sad', 'mad', 'did', 'rid', 'and', 'sand', 'dim'],
    story: ['dad and the man ran.', 'the sand is in the tin.'], q: ['Who ran?', 'Dad and the man.'] },
  { new: 'o', hear: ['on', 'not', 'mom', 'dot'], read: ['on', 'not', 'mom', 'dot', 'rod', 'nod', 'fond'],
    story: ['mom is not sad.', 'dad is on the raft.'], q: ['Is mom sad?', 'No.'] },
  { new: 'c', hear: ['cat', 'can', 'cot', 'cast'], read: ['cat', 'can', 'cot', 'cod', 'scan', 'cast', 'act'],
    story: ['the cat sat on the mat.', 'a cat can sit.'], q: ['Where did the cat sit?', 'On the mat.'] },
  { new: 'h', tricky: ['has'], hear: ['hat', 'him', 'hot', 'hand'], read: ['hat', 'him', 'hot', 'hid', 'hand', 'hint'],
    story: ['the cat hid in the hat.', 'it is hot in the hat.'], q: ['Where did the cat hide?', 'In the hat.'] },
  { new: 'g', hear: ['got', 'dig', 'dog', 'gift'], read: ['got', 'dig', 'tag', 'rag', 'hog', 'dog', 'gift', 'grin'],
    story: ['the dog got a rag.', 'the dog has a gift.'], q: ['What did the dog get?', 'A rag.'] },
  { new: 'l', hear: ['lot', 'lid', 'log', 'hill'], read: ['lot', 'lid', 'log', 'land', 'lift', 'doll', 'hill', 'glad'],
    story: ['the dog sat on a log.', 'a lid is on the tin.'], q: ['What did the dog sit on?', 'A log.'] },
  { new: 'p', hear: ['pat', 'pin', 'pot', 'pond'], read: ['pat', 'pin', 'pot', 'top', 'map', 'nap', 'pond', 'lamp', 'spin'],
    story: ['dad got a map.', 'the cat has a nap on the pad.'], q: ['What did dad get?', 'A map.'] },
  { new: 'e', hear: ['set', 'ten', 'pet', 'nest'], read: ['set', 'ten', 'net', 'pet', 'red', 'hen', 'leg', 'let', 'help', 'nest'],
    story: ['the hen is in the nest.', 'ten red pens.'], q: ['Where is the hen?', 'In the nest.'] },
  { new: 'u', hear: ['up', 'sun', 'run', 'mud'], read: ['up', 'sun', 'run', 'cut', 'fun', 'mud', 'hug', 'dust', 'hunt', 'pup'],
    story: ['the pup ran in the sun.', 'the pup is in the mud.'], q: ['Where is the pup now?', 'In the mud.'] },
  { new: 'b', hear: ['bat', 'bed', 'big', 'bus'], read: ['bat', 'bed', 'big', 'but', 'cab', 'bug', 'bus', 'bend', 'crab'],
    story: ['a big bug sat on the bed.', 'the bug is red.'], q: ['What color is the bug?', 'Red.'] },
  { new: 'sh', hear: ['ship', 'shop', 'fish', 'dish'], read: ['ship', 'shop', 'fish', 'shed', 'dish', 'rush', 'shut', 'shell'],
    story: ['the fish is in the dish.', 'shut the shed.'], q: ['Where is the fish?', 'In the dish.'] },
  { new: 'th', hear: ['this', 'that', 'thin', 'bath'], read: ['this', 'that', 'them', 'thin', 'thud', 'path', 'then', 'bath'],
    story: ['this is a big ship.', 'that fish is thin.'], q: ['Is the ship big or little?', 'Big.'] },
  { new: 'w', tricky: ['was'], hear: ['wet', 'win', 'went', 'swim'], read: ['wet', 'win', 'wag', 'went', 'wind', 'swim', 'west', 'well'],
    story: ['the dog was wet.', 'the dog went in the pond.'], q: ['Why was the dog wet?', 'It went in the pond.'] },
  { new: 'ch', tricky: ['his'], hear: ['chip', 'chat', 'lunch', 'much'], read: ['chip', 'chat', 'much', 'chin', 'rich', 'lunch', 'chop', 'chest'],
    story: ['dad had a chip with his lunch.', 'the chip was hot.'], q: ['What did dad have with his lunch?', 'A chip.'] },
  { new: 'k', hear: ['kid', 'kit', 'milk', 'desk'], read: ['kid', 'kit', 'kept', 'skip', 'milk', 'ask', 'desk', 'kiss'],
    story: ['the kid had milk.', 'the kid sat at his desk.'], q: ['What did the kid have?', 'Milk.'] },
  { new: 'ee', tricky: ['i'], hear: ['see', 'feet', 'tree', 'sheep'], read: ['see', 'feet', 'need', 'tree', 'green', 'sleep', 'sheep', 'keep', 'week'],
    story: ['I see a green tree.', 'the sheep is in the tree.'], q: ['What is in the tree?', 'The sheep.'] },
  { new: 'ck', hear: ['back', 'duck', 'kick', 'rock'], read: ['back', 'sick', 'duck', 'kick', 'pick', 'rock', 'black', 'truck', 'deck'],
    story: ['the duck is black.', 'I can kick the rock.'], q: ['What color is the duck?', 'Black.'] },
  { new: 'ing', tricky: ['to'], hear: ['sing', 'ring', 'king', 'swing'], read: ['sing', 'ring', 'thing', 'king', 'bring', 'swing', 'sting', 'singing'],
    story: ['the king can sing.', 'bring the ring to the king.'], q: ['Who can sing?', 'The king.'] },
  { new: 'v', tricky: ['he', 'me', 'we'], hear: ['van', 'vet', 'vest', 'seven'], read: ['van', 'vet', 'vest', 'seven', 'velvet', 'vat'],
    story: ['he has a red van.', 'we went to the vet.'], q: ['What color is the van?', 'Red.'] },
  { new: 'j', tricky: ['she'], hear: ['jam', 'jet', 'jump', 'jog'], read: ['jam', 'jet', 'jog', 'jump', 'just', 'jug', 'jumping'],
    story: ['she can jump.', 'the jet went up.'], q: ['What went up?', 'The jet.'] },
  { new: 'y', tricky: ['be'], hear: ['yes', 'yell', 'yum', 'yak'], read: ['yes', 'yet', 'yell', 'yum', 'yak', 'yelling'],
    story: ['yes, the yak can swim.', 'the yak will be wet.'], q: ['What can swim?', 'The yak.'] },
  { new: 'z', tricky: ['said'], hear: ['zip', 'zap', 'buzz', 'fizz'], read: ['zip', 'zap', 'zest', 'buzz', 'fizz', 'zigzag'],
    story: ['"zip it up," said mom.', 'the bug went buzz.'], q: ['What did the bug do?', 'It went buzz.'] },
  { new: 'x', hear: ['box', 'fox', 'six', 'mix'], read: ['box', 'fox', 'six', 'fix', 'mix', 'wax', 'next'],
    story: ['the fox is in the box.', 'six ducks swim.'], q: ['Where is the fox?', 'In the box.'] },
  { new: 'qu', tricky: ['you', 'of'], hear: ['quit', 'quick', 'quilt', 'quest'], read: ['quit', 'quick', 'quilt', 'quest', 'quack'],
    story: ['the quick fox ran.', 'you can see a lot of ducks.'], q: ['Was the fox fast or slow?', 'Fast. It was quick.'] },
  { new: 'oo', hear: ['moon', 'food', 'soon', 'zoo'], read: ['moon', 'food', 'soon', 'boot', 'cool', 'room', 'zoo', 'spoon'],
    story: ['the moon is up.', 'we went to the zoo.'], q: ['Where did we go?', 'To the zoo.'] },
  { new: 'ar', hear: ['car', 'star', 'park', 'farm'], read: ['car', 'star', 'park', 'farm', 'dark', 'jar', 'shark', 'start'],
    story: ['the car is in the park.', 'it is dark on the farm.'], q: ['Where is the car?', 'In the park.'] },
  { new: 'er', hear: ['her', 'sister', 'under', 'winter'], read: ['her', 'fern', 'after', 'sister', 'under', 'winter', 'letter', 'better'],
    story: ['her sister is in the car.', 'we sing in the winter.'], q: ['Who is in the car?', 'Her sister.'] },
];

// What has been taught by the end of lesson index n (inclusive).
export function taughtBy(n) {
  const sounds = new Set();
  const tricky = new Set();
  for (let i = 0; i <= n; i++) {
    const L = LESSONS[i];
    if (L.new) sounds.add(L.new);
    (L.tricky || []).forEach(t => tricky.add(t));
  }
  return { sounds, tricky };
}

// Words in a sentence, without punctuation.
export const wordsIn = s => s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);

// Can this word be sounded out with what's been taught?
export function readable(word, sounds) {
  return units(word).every(u => sounds.has(soundOf(u)));
}
