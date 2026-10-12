// Crash-proof saves without a database.
// After every change the server seals a copy of the room (encrypted and signed
// with a secret only the server knows) and hands it to each player's browser.
// If the server restarts, the first browser to reconnect gives the copy back
// and the game carries on exactly where it was. Players can't read or edit it.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadSecret() {
  if (process.env.SNAPSHOT_SECRET) return process.env.SNAPSHOT_SECRET;
  // Local development: keep a secret in .data/ so restarts can still restore games.
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../.data/secret');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    const secret = randomBytes(32).toString('hex');
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, secret, { mode: 0o600 });
    } catch {}
    return secret;
  }
}

const KEY = createHash('sha256').update(loadSecret()).digest();

export function seal(data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(data))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal(text) {
  try {
    const raw = Buffer.from(String(text), 'base64url');
    if (raw.length < 29 || raw.length > 400_000) return null;
    const decipher = createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = gunzipSync(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]), { maxOutputLength: 4_000_000 });
    return JSON.parse(json.toString());
  } catch {
    return null; // tampered, corrupt, or sealed with a different secret
  }
}
