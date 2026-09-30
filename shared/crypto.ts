/**
 * Client-side crypto, shared by web and mobile. Pure JS (@noble) because
 * React Native has no Web Crypto (`crypto.subtle`).
 *
 * UPPCL dropped RSA-OAEP + AES-GCM encryption on their API — all endpoints
 * now accept plaintext JSON. The only crypto still needed:
 *   1. solveAltcha() — SHA-256 proof-of-work for login captcha
 *   2. wssEncrypt()/wssDecrypt() — AES-256-CBC for the /wss bill portal
 *
 * Appsavy header encryption lives server-side in src/app/api/complaints/route.ts.
 */

import { cbc } from "@noble/ciphers/aes.js";
import { bytesToUtf8 } from "@noble/ciphers/utils.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ─── ALTCHA proof-of-work ─────────────────────────────────────────────────────

export interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  maxnumber?: number;
}

/**
 * Solve ALTCHA: find n in [0, maxnum] such that SHA256(salt + n) == challenge.
 * Returns the base64-encoded solution token (captchatoken header value).
 */
export async function solveAltcha(c: AltchaChallenge): Promise<string> {
  const maxnum = c.maxnumber ?? 100_000;
  const target = c.challenge.toLowerCase();
  const startMs = Date.now();

  for (let n = 0; n <= maxnum; n++) {
    if (n % 5000 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    if (bytesToHex(sha256(utf8ToBytes(`${c.salt}${n}`))) === target) {
      const took = Date.now() - startMs;
      return btoa(
        JSON.stringify({
          algorithm: c.algorithm,
          challenge: c.challenge,
          number: n,
          salt: c.salt,
          signature: c.signature,
          took,
        })
      );
    }
  }
  throw new Error(`ALTCHA challenge unsolvable within ${maxnum}`);
}

// ─── UPPCL /wss bill portal crypto (AES-256-CBC + PBKDF2-SHA1) ────────────────
// consumer.uppcl.org/wss encrypts request & response bodies as `_cdata`:
//   _cdata = saltHex(32B) + ivHex(16B) + base64( AES-256-CBC(plaintext) )
//   key    = PBKDF2-SHA1(passphrase, salt, 1989 iterations, 32 bytes)
// The passphrase is a constant from the /wss SPA bundle (not user-specific).
// This is the path to the official bill PDF (see docs/api-reverse-engineering.md).
const WSS_PASSPHRASE = "2b57ea4715h#2d6abf1360e8";

function wssAesKey(salt: Uint8Array): Uint8Array {
  return pbkdf2(sha1, utf8ToBytes(WSS_PASSPHRASE), salt, { c: 1989, dkLen: 32 });
}

/** Encrypt a request body for the /wss portal → `_cdata` string. */
export async function wssEncrypt(plaintext: string): Promise<string> {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const ct = cbc(wssAesKey(salt), iv).encrypt(utf8ToBytes(plaintext)); // PKCS7 padding by default
  return bytesToHex(salt) + bytesToHex(iv) + b64Encode(ct);
}

/** Decrypt a `_cdata` response from the /wss portal → plaintext (usually JSON). */
export async function wssDecrypt(cdata: string): Promise<string> {
  const salt = hexToBytes(cdata.slice(0, 64));
  const iv = hexToBytes(cdata.slice(64, 96));
  const ct = Uint8Array.from(atob(cdata.slice(96)), (c) => c.charCodeAt(0));
  return bytesToUtf8(cbc(wssAesKey(salt), iv).decrypt(ct));
}
