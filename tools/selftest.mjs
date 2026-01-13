import { webcrypto } from "node:crypto";
import { decryptBytes, encryptBytes } from "./crypto.mjs";

const crypto = webcrypto;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function assertEqualBytes(a, b, label) {
  if (a.length !== b.length) {
    throw new Error(`${label} length mismatch`);
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      throw new Error(`${label} mismatch at ${i}`);
    }
  }
}

async function run() {
  const password = "test-passphrase";
  const iterations = 120000;

  const random = new Uint8Array(64);
  crypto.getRandomValues(random);
  const encryptedRandom = await encryptBytes(password, random, iterations);
  const decryptedRandom = await decryptBytes(password, encryptedRandom);
  await assertEqualBytes(random, decryptedRandom, "random bytes");

  const jsonText = JSON.stringify({ hello: "world", value: 42 });
  const jsonBytes = textEncoder.encode(jsonText);
  const encryptedJson = await encryptBytes(password, jsonBytes, iterations);
  const decryptedJson = await decryptBytes(password, encryptedJson);
  const decoded = textDecoder.decode(decryptedJson);
  if (decoded !== jsonText) {
    throw new Error("JSON round-trip mismatch");
  }

  console.log("Crypto self-test passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
