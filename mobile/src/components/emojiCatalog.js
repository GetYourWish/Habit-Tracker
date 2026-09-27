// emojiCatalog.js — the habit icon library, asked for by the user:
// "widen the emoji choice when it comes to assigning a new habit".
//
// 350+ emojis organized in categories, a keyword search over the entries
// people actually look for ("brush", "run", "sleep", "water"…), and a
// free-form custom slot so ANY emoji can be pasted in. The mobile app ships
// the same catalogue (mobile/src/components/emojiCatalog.js) — keep the two
// in sync when adding categories here.

export const EMOJI_CATEGORIES = [
  { key: 'care', label: 'Care', icon: '🪥', emojis: [
    '🪥', '🦷', '🧼', '🧴', '🫧', '🛁', '🚿', '🧽', '🧹', '🪒', '💈', '💇',
    '🧑‍🦰', '💅', '🪞', '🩹', '🩺', '💊', '💉', '🩻', '🦴', '👁️', '👂', '🧑‍⚕️',
    '🧺', '🧦', '👕', '🩳', '🧤', '🧣'
  ] },
  { key: 'body', label: 'Body', icon: '💪', emojis: [
    '💪', '🫀', '🫁', '🧠', '🦵', '🦶', '🤸', '🧘', '🧘‍♀️', '🧘‍♂️', '🤾', '🏋️',
    '🏋️‍♀️', '🏋️‍♂️', '🤼', '🤸‍♀️', '🤸‍♂️', '⛹️', '⛹️‍♀️', '🤺', '🥊', '🥋', '🤳', '🙆',
    '🧎', '🧑‍🦼', '🦯', '👃', '👄', '🙋', '🕺', '💃'
  ] },
  { key: 'fitness', label: 'Fitness', icon: '🏃', emojis: [
    '🏃', '🏃‍♀️', '🏃‍♂️', '🚶', '🚶‍♀️', '🚶‍♂️', '🚴', '🚴‍♀️', '🚵', '🚵‍♀️', '🥾', '⛰️',
    '🏔️', '🧗', '🧗‍♀️', '🤿', '🏊', '🏊‍♀️', '🏄', '🚣', '🛹', '⛸️', '🎿', '🥌',
    '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🥏', '🎱', '🏓', '🏸', '🥅'
  ] },
  { key: 'food', label: 'Food', icon: '🥗', emojis: [
    '💧', '🥤', '☕', '🍵', '🧉', '🥛', '🧃', '🍎', '🍏', '🍐', '🍊', '🍋',
    '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅',
    '🥑', '🥦', '🥬', '🥕', '🌽', '🥒', '🫑', '🧄', '🧅', '🥔', '🍠', '🥗',
    '🥙', '🥪', '🌮', '🌯', '🍳', '🍲', '🥣', '🥘', '🍜', '🍣', '🥟',
    '🍚', '🍱', '🥠', '🍢', '🧆', '🥫', '🍯', '🥜', '🫘', '🍿', '🧂', '🍫'
  ] },
  { key: 'mind', label: 'Mind', icon: '🧠', emojis: [
    '🧠', '📖', '📚', '📕', '📗', '📘', '📙', '📓', '📔', '📒', '📜', '📃',
    '📝', '✍️', '🖋️', '✏️', '🗒️', '🗂️', '🗃️', '🗄️', '📇', '🧩', '♟️', '🎴',
    '🎨', '🎧', '🎼', '🎹', '🎸', '🎺', '🎻', '🥁', '🎤', '📻', '📖', '🧠'
  ] },
  { key: 'calm', label: 'Calm', icon: '🧘', emojis: [
    '🧘', '😇', '🙏', '🌸', '💮', '🏵️', '🌿', '☘️', '🍀', '🍃', '🌾', '🌬️',
    '😴', '🛌', '🛏️', '💤', '🌙', '⭐', '🌟', '✨', '☄️', '🌌', '🪐', '🔭',
    '🫧', '🕯️', '🪷', '🧿', '☯️', '🕉️', '☸️', '✡️', '😇', '🙇', '😌', '🥰'
  ] },
  { key: 'work', label: 'Work', icon: '💼', emojis: [
    '💼', '🖥️', '💻', '⌨️', '🖱️', '📋', '📁', '📂', '📅', '🗓️',
    '📆', '⏰', '⏳', '⌛', '⏱️', '🕰️', '📊', '📈', '📉', '💰', '🤑',
    '🏦', '💳', '🧾', '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🗒️',
    '🔍', '🔎', '🔬', '🧪', '💡', '🔧', '🔨', '⚙️', '🧰', '🔩', '🪛', '🪚'
  ] },
  { key: 'home', label: 'Home', icon: '🏠', emojis: [
    '🏠', '🏡', '🚪', '🛋️', '🪑', '🛏️', '🧺', '🧻', '🧼', '🪣', '🧽', '🧹',
    '🗑️', '🚮', '🪟', '🌱', '🪴', '🌳', '🌴', '🌵', '🎍', '🫧',
    '🔪', '🍽️', '🍴', '🥄', '🍶', '🫖', '🧊', '🥢', '🔌', '🔋', '💡',
    '🛠️', '🧑‍🔧', '🧰', '🪝', '🧵', '🪡', '🧶', '🧦', '🪀', '🧸'
  ] },
  { key: 'nature', label: 'Nature', icon: '🌱', emojis: [
    '🌱', '🌿', '☘️', '🍀', '🍃', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻',
    '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌗', '🌑', '🌍', '🌎', '🌏', '🌐',
    '🌈', '☁️', '⛅', '🌤️', '🌧️', '⛈️', '🌨️', '❄️', '🌪️', '🌫️', '🌊', '💧',
    '🔥', '⚡', '🐕', '🐈', '🦮', '🐕‍🦺', '🐦', '🕊️', '🦜', '🐟', '🐠', '🐢',
    '🦋', '🐝', '🐞', '🐌', '🐜', '🕷️', '🐴', '🐮', '🐷', '🐑', '🐐', '🦙'
  ] },
  { key: 'people', label: 'People', icon: '👨‍👩‍👧', emojis: [
    '👨‍👩‍👧', '👪', '🧑‍🤝‍🧑', '👥', '👤', '🗣️', '💬', '🗨️', '💭', '📳', '📱', '📵',
    '☎️', '📞', '📟', '📠', '📨', '📩', '💌', '📧', '📥', '📤', '📦', '🏷️',
    '🤝', '🙋', '🙆', '🙇', '🤗', '🤭', '😊', '😁', '😉', '😎', '🤓', '🥳',
    '😍', '🥰', '😗', '😙', '😚', '🫂', '👋', '🤙', '✌️', '🤞', '🫶', '🤟'
  ] },
  { key: 'fun', label: 'Fun', icon: '🎮', emojis: [
    '🎮', '🕹️', '🎲', '🎯', '🎳', '🎰', '🧩', '🎪', '🎭', '🎨', '🎬', '🍿',
    '🎤', '🎧', '🎼', '🎹', '🥁', '🎸', '🎺', '🎻', '🎷', '🪕', '🎙️',
    '🎉', '🎊', '🎈', '🎁', '🪅', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️',
    '👑', '💎', '🎟️', '🎫', '🎡', '🎠', '🎢', '🏕️', '🏖️', '🚀', '🗺️',
    '🧭', '🛼', '🛷', '🪁', '🎴', '🀄', '⛳', '🏌️', '🎣', '📷', '🎥', '🎰'
  ] },
  { key: 'symbols', label: 'Symbols', icon: '⭐', emojis: [
    '⭐', '🌟', '✨', '⚡', '🔥', '💥', '💯', '✅', '❌', '❗', '❓', '‼️',
    '🔁', '🔂', '🔄', '♻️', '⚜️', '🔱', '📛', '🔰', '⚠️', '🚸', '💜', '💚',
    '💙', '💛', '🧡', '❤️', '🩷', '🖤', '🤍', '🤎', '💫', '🕳️', '🧿', '🪬',
    '🕐', '🕥', '⌛', '⏳', '🗓️', '📅', '📆', '🗯️', '💤', '🎐', '🧿', '🌈'
  ] }
]

// Curated search keywords → the emojis people mean. Query words match against
// both the keywords here and the category label, so "fitness" finds the whole
// Fitness tab even without per-emoji keywords.
export const EMOJI_KEYWORDS = {
  brush: ['🪥', '🦷'], teeth: ['🦷', '🪥'], floss: ['🦷'], shower: ['🚿', '🛁'],
  bath: ['🛁'], soap: ['🧼'], clean: ['🧽', '🧹', '🧼'], skincare: ['🧴'],
  lotion: ['🧴'], cream: ['🧴'], hair: ['💇', '🧑‍🦰'], nail: ['💅'], shave: ['🪒'],
  medicine: ['💊', '💉'], pill: ['💊'], doctor: ['🩺', '🧑‍⚕️'], bandage: ['🩹'],
  water: ['💧', '🥤'], drink: ['💧', '🥤', '☕', '🍵'], coffee: ['☕'], tea: ['🍵', '🫖'],
  smoothie: ['🧃'], juice: ['🧃', '🥤'], milk: ['🥛'], fruit: ['🍎', '🍐', '🍊', '🍌', '🍓', '🍇'],
  apple: ['🍎'], banana: ['🍌'], veg: ['🥦', '🥕', '🥬', '🥒'], salad: ['🥗'],
  cook: ['🍳', '🍲', '🥘'], breakfast: ['🍳', '🥣'], lunch: ['🥪', '🍱'], dinner: ['🍽️'],
  eat: ['🍽️', '🍴'], snack: ['🥜', '🍿', '🍫'], supplement: ['💊'], vitamin: ['💊'],
  run: ['🏃', '🏃‍♀️', '🏃‍♂️'], walk: ['🚶', '🚶‍♀️', '🚶‍♂️'], hike: ['🥾', '⛰️', '🏔️'],
  bike: ['🚴', '🚴‍♀️'], cycle: ['🚴', '🚵'], swim: ['🏊', '🏊‍♀️'], gym: ['🏋️', '🏋️‍♀️', '🏋️‍♂️'],
  lift: ['🏋️', '💪'], stretch: ['🤸', '🧘'], yoga: ['🧘', '🧘‍♀️', '🧘‍♂️'], meditate: ['🧘', '🧠'],
  sport: ['⚽', '🏀', '🎾', '🏐'], football: ['⚽'], soccer: ['⚽'], basketball: ['🏀'],
  tennis: ['🎾'], boxing: ['🥊'], martial: ['🥋'], climb: ['🧗', '🧗‍♀️'], dance: ['💃', '🕺'],
  sleep: ['😴', '🛌', '🛏️', '💤'], bed: ['🛏️', '🛌'], nap: ['💤'], night: ['🌙', '🌜'],
  read: ['📖', '📚'], book: ['📖', '📚', '📕', '📗', '📘', '📙'], study: ['📖', '📚', '📝'],
  learn: ['🧠', '📖', '📚'], write: ['✍️', '📝', '🖋️'], journal: ['📔', '📝', '📓'],
  music: ['🎧', '🎼', '🎵'], piano: ['🎹'], guitar: ['🎸'], sing: ['🎤', '🎙️'],
  draw: ['🎨', '✏️'], paint: ['🎨'], create: ['🎨', '💡'], code: ['💻', '🖥️'],
  work: ['💼', '💻', '🖥️'], office: ['💼'], email: ['📧', '📩', '💌'], inbox: ['📥', '📤'],
  money: ['💰', '🤑', '🏦', '💳'], save: ['🏦', '💰'], budget: ['💰', '🧾'], finance: ['📈', '📉'],
  clean_house: ['🧹', '🧽', '🧺'], laundry: ['🧺'], dishes: ['🍽️', '🧽'], tidy: ['🧹', '🗂️'],
  trash: ['🗑️'], recycle: ['♻️'], garden: ['🌱', '🪴', '🌳', '🌺'], plant: ['🌱', '🪴'],
  water_plant: ['🪴', '💧'], pet: ['🐕', '🐈', '🐦'], dog: ['🐕', '🦮', '🐕‍🦺'], cat: ['🐈'],
  bird: ['🐦', '🦜', '🕊️'], fish: ['🐟', '🐠'], turtle: ['🐢'], horse: ['🐴'],
  family: ['👨‍👩‍👧', '👪'], friend: ['🧑‍🤝‍🧑', '🤝'], call: ['📞', '☎️'], text: ['💬', '📱'],
  phone: ['📱', '📵'], social: ['🧑‍🤝‍🧑', '🗣️', '💬'], love: ['❤️', '🥰', '😍'],
  gratitude: ['🙏', '😇'], pray: ['🙏', '🙏'], relax: ['🛁', '🧘', '🕯️'], breathe: ['🌬️', '🫧'],
  sun: ['🌞', '☀️', '🌝'], moon: ['🌙', '🌛', '🌜'], star: ['⭐', '🌟'], celebrate: ['🎉', '🎊'],
  party: ['🥳', '🎉', '🎈'], win: ['🏆', '🥇'], trophy: ['🏆', '🏅'], goal: ['🎯', '🏆'],
  focus: ['🎯', '🔍'], idea: ['💡', '🧠'], fix: ['🔧', '🔨', '🛠️'], build: ['🔨', '🛠️', '🧱'],
  time: ['⏰', '⌛', '⏳', '🕰️'], alarm: ['⏰'], timer: ['⏱️'], calendar: ['📅', '🗓️', '📆'],
  repeat: ['🔁', '🔂'], habit: ['🔁', '♻️', '🔄'], no_phone: ['📵'], journaling: ['📔'],
  earth: ['🌍', '🌎', '🌏'], weather: ['🌈', '☁️', '🌤️', '🌧️'], snow: ['❄️', '🌨️'],
  rocket: ['🚀'], travel: ['🗺️', '🧭', '✈️'], game: ['🎮', '🕹️', '🎲'], movie: ['🎬', '🍿'],
  photo: ['📷'], craft: ['✂️', '🧶', '🪡'], knit: ['🧶'], gift: ['🎁', '🎀'], smile: ['😊', '😁', '😄']
}

// Deduplicated master list (order-preserving) — what the editor grid shows
// when no category/search filter is active.
export const ALL_EMOJIS = (() => {
  const seen = new Set()
  const out = []
  for (const cat of EMOJI_CATEGORIES) {
    for (const e of cat.emojis) {
      if (e && !seen.has(e)) {
        seen.add(e)
        out.push(e)
      }
    }
  }
  return out
})()

// Search: keyword match first (curated), then category-label match. Returns a
// flat emoji list, deduplicated.
export function searchEmojis(query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const out = []
  const seen = new Set()
  const push = e => {
    if (e && !seen.has(e)) {
      seen.add(e)
      out.push(e)
    }
  }
  for (const [kw, list] of Object.entries(EMOJI_KEYWORDS)) {
    if (kw.includes(q)) list.forEach(push)
  }
  for (const cat of EMOJI_CATEGORIES) {
    if (cat.label.toLowerCase().includes(q) || cat.key.includes(q)) {
      cat.emojis.forEach(push)
    }
  }
  return out
}
