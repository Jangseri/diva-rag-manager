const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = BigInt(ALPHABET.length);

let counter = 0;
let lastTimestamp = 0;

function toBase62(value: bigint): string {
  if (value === 0n) return ALPHABET[0];
  let result = "";
  let v = value;
  while (v > 0n) {
    result = ALPHABET[Number(v % BASE)] + result;
    v = v / BASE;
  }
  return result;
}

export function generateTsid(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    counter++;
  } else {
    counter = 0;
    lastTimestamp = now;
  }

  const timestamp = BigInt(now);
  const seq = BigInt(counter);

  // timestamp(42bit) + sequence(22bit) = 충분한 유니크성 보장
  const combined = (timestamp << 22n) | seq;
  return toBase62(combined);
}
