/**
 * 本地密钥保险箱（vault）
 *
 * 用户设置一个「保险箱密码」，经 PBKDF2 派生出 AES-256-GCM 密钥，
 * 用该密钥加密所有私钥 JWK（以信封形式存 localStorage）。
 * 公钥与链头保持明文（非敏感）。派生密钥只存活于内存，刷新页面需重新输入密码。
 */
import { bufToBase64, base64ToBuf } from "./crypto.js";

export type VaultStatus = "none" | "locked" | "unlocked";

const VAULT_KEY = "novi:e2e:vault";
const PBKDF2_ITERATIONS = 310_000;

interface VaultRecord {
    v: 1;
    salt: string; // base64, 16 bytes
    iv: string;   // base64, 12 bytes
    ct: string;   // base64, AES-256-GCM ciphertext of the envelope JSON
}

interface VaultEnvelope {
    secrets: { key: string; priv: string }[];
}

let activeKey: CryptoKey | null = null;
let activeMyId: string | null = null;

function readRecord(myId: string): VaultRecord | null {
    try {
        const raw = localStorage.getItem(`${VAULT_KEY}:${myId}`);
        if (!raw) return null;
        const rec = JSON.parse(raw) as VaultRecord;
        if (rec.v !== 1 || !rec.salt || !rec.iv || !rec.ct) return null;
        return rec;
    } catch {
        return null;
    }
}

function writeRecord(myId: string, rec: VaultRecord): void {
    localStorage.setItem(`${VAULT_KEY}:${myId}`, JSON.stringify(rec));
}

function removeRecord(myId: string): void {
    localStorage.removeItem(`${VAULT_KEY}:${myId}`);
}

async function deriveKey(password: string, saltB64: string): Promise<CryptoKey> {
    const salt = base64ToBuf(saltB64);
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password) as BufferSource, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

function genSalt(): string {
    return bufToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

function genIv(): string {
    return bufToBase64(crypto.getRandomValues(new Uint8Array(12)));
}

async function encryptEnvelope(key: CryptoKey, envelope: VaultEnvelope, ivB64: string): Promise<string> {
    const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: base64ToBuf(ivB64) as BufferSource },
        key,
        new TextEncoder().encode(JSON.stringify(envelope)) as BufferSource
    );
    return bufToBase64(new Uint8Array(ct));
}

async function decryptEnvelope(key: CryptoKey, ivB64: string, ctB64: string): Promise<VaultEnvelope> {
    const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBuf(ivB64) as BufferSource },
        key,
        base64ToBuf(ctB64) as BufferSource
    );
    return JSON.parse(new TextDecoder().decode(plain));
}

const envelopeKey = (friendId: string, novicode: string) => `${friendId}|${novicode}`;

export function vaultStatus(myId: string): VaultStatus {
    if (activeKey && activeMyId === myId) return "unlocked";
    return readRecord(myId) ? "locked" : "none";
}

export function isVaultUnlocked(myId: string): boolean {
    return activeKey !== null && activeMyId === myId;
}

export async function setupVault(myId: string, password: string): Promise<void> {
    const salt = genSalt();
    const key = await deriveKey(password, salt);
    const iv = genIv();
    const ct = await encryptEnvelope(key, { secrets: [] }, iv);
    writeRecord(myId, { v: 1, salt, iv, ct });
    activeKey = key;
    activeMyId = myId;
}

export async function unlockVault(myId: string, password: string): Promise<boolean> {
    const rec = readRecord(myId);
    if (!rec) return false;
    try {
        const key = await deriveKey(password, rec.salt);
        await decryptEnvelope(key, rec.iv, rec.ct);
        activeKey = key;
        activeMyId = myId;
        return true;
    } catch {
        return false;
    }
}

export async function changeVaultPassword(myId: string, oldPassword: string, newPassword: string): Promise<void> {
    const rec = readRecord(myId);
    if (!rec) throw new Error("尚未设置保险箱");
    const oldKey = await deriveKey(oldPassword, rec.salt);
    let envelope: VaultEnvelope;
    try {
        envelope = await decryptEnvelope(oldKey, rec.iv, rec.ct);
    } catch {
        throw new Error("当前密码不正确");
    }
    const salt = genSalt();
    const iv = genIv();
    const newKey = await deriveKey(newPassword, salt);
    const ct = await encryptEnvelope(newKey, envelope, iv);
    writeRecord(myId, { v: 1, salt, iv, ct });
    activeKey = newKey;
    activeMyId = myId;
}

export function lockVault(): void {
    activeKey = null;
    activeMyId = null;
}

export function clearVault(myId: string): void {
    removeRecord(myId);
    if (activeMyId === myId) {
        activeKey = null;
        activeMyId = null;
    }
}

export async function readSecrets(myId: string): Promise<Map<string, JsonWebKey>> {
    if (!activeKey || activeMyId !== myId) return new Map();
    const rec = readRecord(myId);
    if (!rec) return new Map();
    try {
        const envelope = await decryptEnvelope(activeKey, rec.iv, rec.ct);
        const map = new Map<string, JsonWebKey>();
        for (const s of envelope.secrets) {
            map.set(s.key, JSON.parse(s.priv));
        }
        return map;
    } catch {
        return new Map();
    }
}

export async function writeSecrets(myId: string, secrets: Map<string, JsonWebKey>): Promise<void> {
    if (!activeKey || activeMyId !== myId) return;
    const rec = readRecord(myId);
    if (!rec) return;
    const envelope: VaultEnvelope = {
        secrets: Array.from(secrets.entries()).map(([key, priv]) => ({ key, priv: JSON.stringify(priv) })),
    };
    const iv = genIv();
    const ct = await encryptEnvelope(activeKey, envelope, iv);
    writeRecord(myId, { v: 1, salt: rec.salt, iv, ct });
}

export function envelopeKeyFor(friendId: string, novicode: string): string {
    return envelopeKey(friendId, novicode);
}
