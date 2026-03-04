/**
 * ADSentinel — AES-256-GCM field-level encryption
 *
 * Used to encrypt AD bind passwords before storing in the database.
 * Requires FIELD_ENCRYPTION_KEY env var — 32-byte hex string (64 hex chars).
 *
 * Generate a key:   openssl rand -hex 32
 */

"use strict";

const crypto = require("crypto");

const ALGORITHM  = "aes-256-gcm";
const IV_LENGTH  = 16; // bytes
const TAG_LENGTH = 16; // bytes (GCM auth tag)

function getKey() {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw || raw.length !== 64) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string in the format:  iv:ciphertext:tag
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv  = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Store iv + ciphertext + tag, all base64 separated by ":"
  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    tag.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a value previously produced by encrypt().
 * Returns the original plaintext string, or null on failure.
 */
function decrypt(ciphertext) {
  if (!ciphertext) return null;

  // Handle legacy unencrypted values gracefully — if value doesn't match
  // the expected "iv:ciphertext:tag" format, return as-is so the bind
  // attempt can fail naturally rather than crashing the app.
  const parts = String(ciphertext).split(":");
  if (parts.length !== 3) {
    return ciphertext; // legacy plaintext — will fail AD bind, not crash app
  }

  try {
    const key     = getKey();
    const iv      = Buffer.from(parts[0], "base64");
    const content = Buffer.from(parts[1], "base64");
    const tag     = Buffer.from(parts[2], "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return decipher.update(content, undefined, "utf8") + decipher.final("utf8");
  } catch (err) {
    // Wrong key, tampered data, or legacy value — return null so bind fails cleanly
    return null;
  }
}

module.exports = { encrypt, decrypt };
