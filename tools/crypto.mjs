import { webcrypto } from "node:crypto";

const crypto = webcrypto;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAGIC = textEncoder.encode("LIB1");
const HEADER_SIZE = 36;
const ERROR_MESSAGE = "Wrong password or corrupted file";

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new TypeError("Expected Uint8Array or ArrayBuffer");
}

export async function deriveKey(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBytes(password, plaintextBytes, iterations = 300000) {
  const plain = toUint8Array(plaintextBytes);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plain
  );
  const ciphertext = new Uint8Array(encrypted);
  const output = new Uint8Array(HEADER_SIZE + ciphertext.length);
  output.set(MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint32(4, iterations, false);
  output.set(salt, 8);
  output.set(iv, 24);
  output.set(ciphertext, 36);
  return output;
}

function parseHeader(encBytes) {
  const bytes = toUint8Array(encBytes);
  if (bytes.length < HEADER_SIZE) {
    throw new Error(ERROR_MESSAGE);
  }
  const magic = textDecoder.decode(bytes.slice(0, 4));
  if (magic !== "LIB1") {
    throw new Error(ERROR_MESSAGE);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iterations = view.getUint32(4, false);
  const salt = bytes.slice(8, 24);
  const iv = bytes.slice(24, 36);
  const ciphertext = bytes.slice(36);
  return { iterations, salt, iv, ciphertext };
}

export async function decryptBytes(password, encBytes) {
  let header;
  try {
    header = parseHeader(encBytes);
  } catch (error) {
    throw new Error(ERROR_MESSAGE);
  }
  try {
    const key = await deriveKey(password, header.salt, header.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: header.iv },
      key,
      header.ciphertext
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    throw new Error(ERROR_MESSAGE);
  }
}
