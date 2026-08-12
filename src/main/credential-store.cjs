'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const QRCode = require('qrcode');
const { base32Encode, totp } = require('./totp.cjs');

const SCHEMA_VERSION = 1;
const MAX_LOCKS = 5000;
const enrollments = new Map();

function storePath() {
  return path.join(app.getPath('userData'), 'toy-locks.v1.json');
}

function cleanText(value, name, max = 512) {
  if (typeof value !== 'string') throw new Error(`${name} must be text.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || /[\0\r\n]/.test(cleaned)) throw new Error(`${name} is invalid.`);
  return cleaned;
}

function requireEncryption() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The operating-system credential vault is unavailable. No lock was created.');
}

function encryptRecord(record) {
  requireEncryption();
  return safeStorage.encryptString(JSON.stringify(record)).toString('base64');
}

function decryptRecord(ciphertext) {
  requireEncryption();
  const raw = safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
  return JSON.parse(raw);
}

async function readStore() {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath(), 'utf8'));
    if (parsed?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.locks) || parsed.locks.length > MAX_LOCKS) throw new Error('Unsupported lock store.');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: SCHEMA_VERSION, locks: [] };
    throw new Error('The local toy-lock store is unavailable or corrupt. No lock state was changed.');
  }
}

async function writeStore(store) {
  const target = storePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporary, target).catch(async (error) => {
    await fs.rm(temporary, { force: true });
    throw error;
  });
}

function publicLock(lock) {
  return {
    id: lock.id,
    targetId: lock.targetId,
    targetLabel: lock.targetLabel,
    method: lock.method,
    duration: lock.duration,
    createdAt: lock.createdAt
  };
}

async function listLocks() {
  return (await readStore()).locks.map(publicLock);
}

function verifyTotp(secret, candidate) {
  const code = String(candidate || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((offset) => crypto.timingSafeEqual(Buffer.from(totp(secret, Date.now(), offset)), Buffer.from(code)));
}

async function beginOtp({ targetId, targetLabel }) {
  const id = crypto.randomUUID();
  const secret = base32Encode(crypto.randomBytes(20));
  const label = cleanText(targetLabel, 'Target label', 240);
  const account = cleanText(targetId, 'Target identifier', 240);
  const uri = `otpauth://totp/${encodeURIComponent(`Material Encryption:${label}`)}?secret=${secret}&issuer=${encodeURIComponent('Material Encryption')}&algorithm=SHA1&digits=6&period=30`;
  enrollments.set(id, { secret, targetId: account, targetLabel: label, expiresAt: Date.now() + 10 * 60 * 1000 });
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 4, width: 240, color: { dark: '#000000', light: '#ffffff' } });
  return { enrollmentId: id, manualSecret: secret.match(/.{1,4}/g).join(' '), uri, qrDataUrl, algorithm: 'SHA-1', digits: 6, period: 30 };
}

async function createLock(payload) {
  const targetId = cleanText(payload.targetId, 'Target identifier', 240);
  const targetLabel = cleanText(payload.targetLabel, 'Target label', 240);
  const method = payload.method === 'otp' ? 'otp' : payload.method === 'password' ? 'password' : null;
  if (!method) throw new Error('Choose password or TOTP.');
  const durations = new Set(['surface', '15m', '60m', 'session']);
  if (!durations.has(payload.duration)) throw new Error('Choose a supported unlock duration.');
  const store = await readStore();
  if (store.locks.some((lock) => lock.targetId === targetId)) throw new Error('This exact element already has a lock. Remove it before creating another.');
  if (store.locks.length >= MAX_LOCKS) throw new Error('The lock list has reached its bounded limit.');

  let credential;
  if (method === 'password') {
    const password = cleanText(payload.credential, 'Password', 1024);
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 32);
    credential = { kind: 'password', salt: salt.toString('base64'), hash: hash.toString('base64') };
  } else {
    const enrollment = enrollments.get(payload.enrollmentId);
    enrollments.delete(payload.enrollmentId);
    if (!enrollment || enrollment.expiresAt < Date.now() || enrollment.targetId !== targetId || !verifyTotp(enrollment.secret, payload.credential)) throw new Error('The current TOTP code did not match. Start pairing again.');
    credential = { kind: 'otp', secret: enrollment.secret };
  }

  const lock = {
    id: crypto.randomUUID(), targetId, targetLabel, method, duration: payload.duration,
    createdAt: new Date().toISOString(), encryptedCredential: encryptRecord(credential)
  };
  store.locks.push(lock);
  await writeStore(store);
  return publicLock(lock);
}

async function verifyLock({ lockId, credential }) {
  const id = cleanText(lockId, 'Lock identifier', 80);
  const store = await readStore();
  const lock = store.locks.find((entry) => entry.id === id);
  if (!lock) throw new Error('That lock no longer exists.');
  const record = decryptRecord(lock.encryptedCredential);
  let valid = false;
  if (record.kind === 'password') {
    const candidate = crypto.scryptSync(String(credential || ''), Buffer.from(record.salt, 'base64'), 32);
    valid = crypto.timingSafeEqual(candidate, Buffer.from(record.hash, 'base64'));
  } else if (record.kind === 'otp') valid = verifyTotp(record.secret, credential);
  if (!valid) throw new Error('The credential did not match. Delete the application-data folder to reset this toy lock.');
  return publicLock(lock);
}

async function removeLock(payload) {
  await verifyLock(payload);
  const store = await readStore();
  const next = store.locks.filter((entry) => entry.id !== payload.lockId);
  if (next.length === store.locks.length) throw new Error('That lock no longer exists.');
  await writeStore({ schemaVersion: SCHEMA_VERSION, locks: next });
  return true;
}

module.exports = { listLocks, beginOtp, createLock, verifyLock, removeLock };
