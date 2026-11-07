import { randomBytes, scryptSync, timingSafeEqual, createHash, randomInt } from 'node:crypto';

export const newId = () => randomBytes(9).toString('base64url');
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('base64url');

export function hashPin(pin) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(pin, salt, 32).toString('base64url');
  return { salt, hash };
}

export function verifyPin(pin, salt, hash) {
  if (!salt || !hash) return false;
  const a = scryptSync(pin, salt, 32);
  const b = Buffer.from(hash, 'base64url');
  return a.length === b.length && timingSafeEqual(a, b);
}

const CODE_WORDS = [
  'JINGLE', 'TINSEL', 'COCOA', 'SLEIGH', 'COOKIE', 'MITTEN', 'GARLAND', 'SPRUCE',
  'HOLLY', 'FROSTY', 'PUDDING', 'NUTMEG', 'GINGER', 'WREATH', 'EGGNOG', 'CAROL',
  'PINECONE', 'SNOWDRIFT', 'TOFFEE', 'CINNAMON', 'SPARKLE', 'BAUBLE', 'CHIMNEY', 'FIRESIDE',
];

export function newFamilyCode(taken) {
  for (;;) {
    const word = CODE_WORDS[randomInt(CODE_WORDS.length)];
    const code = `${word}-${String(randomInt(1000, 10000))}`;
    if (!taken(code)) return code;
  }
}
