// src/utils/profanity.js

// Lista base — ajusta a tu realidad
const BAD_WORDS_BASE = [
  'mierda','puta','puto','carajo','pendejo','boludo','pelotudo','imbecil','idiota'
];

// Variantes por letra (acentos + "leet" básico)
const CHAR_VARIANTS = {
  a: '[aáàäâ@4]',
  e: '[eéèëê3]',
  i: '[iíìïî1]',
  o: '[oóòöô0]',
  u: '[uúùüû]',
  n: '[nñ]',
  s: '[s5]',
  c: '[cç]'
};

// palabra -> patrón robusto (tolera repeticiones "miiierda")
function wordToPattern(word, allowRepeats = true) {
  const chars = [...word.normalize('NFC').toLowerCase()];
  const pat = chars.map(ch => {
    const base = CHAR_VARIANTS[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return allowRepeats ? `${base}{1,3}` : base;
  }).join('');
  // bordes no-letra/número/_ (Unicode)
  return `(?<![\\p{L}\\p{N}_])${pat}(?![\\p{L}\\p{N}_])`;
}

const PROFANITY_REGEX = new RegExp(
  BAD_WORDS_BASE.map(w => wordToPattern(w)).join('|'),
  'giu'
);

const mask = (m) => '*'.repeat([...m].length);

/** Censura un texto reemplazando groserías por asteriscos */
export function censorText(text) {
  if (typeof text !== 'string' || !text) return text ?? '';
  return text.replace(PROFANITY_REGEX, (m) => mask(m));
}
