/**
 * novi 客户端密钥存储（用户自管，平台不持有）
 *
 * 为每个 (myId, friendId, novicode) 维护一个 5 元组：
 *   { friendId, novicode, ownPrivateKey(JWK), ownPublicKey(JWK), friendPublicKey(JWK) }
 * 另为每个链维护链头 currHash（首条为创世值）。
 *
 * 存储：
 *  - 公钥 + 链头：localStorage 明文（非敏感）
 *  - 私钥：经 vault（保险箱密码）AES-256-GCM 加密后存 localStorage（见 vault.ts）
 *    vault 未解锁时私钥不可读（ownPrivateKey 为空对象），isReady 会返回 false。
 *
 * 提供导出/导入 JSON 备份（需 vault 已解锁），私钥丢失时可恢复。
 */
import { GENESIS_PRE_HASH } from "./crypto.js";
import {
    isVaultUnlocked,
    readSecrets,
    writeSecrets,
    clearVault,
    envelopeKeyFor,
    vaultStatus,
    setupVault,
} from "./vault.js";
import { toast } from "sonner";

export interface FriendKeyTuple {
    friendId: string;
    novicode: string;
    ownPrivateKey: JsonWebKey;
    ownPublicKey: JsonWebKey;
    friendPublicKey: JsonWebKey;
}

export interface KeyBundle {
    myId: string;
    tuples: FriendKeyTuple[];
    chainHeads: Record<string, string>; // key: `${friendId}|${novicode}` -> currHash
}

const STORE_KEY = "novi:e2e:keys";
const HEADS_KEY = "novi:e2e:chainheads";

// 配额失败去抖：写 localStorage 失败（通常 5MB 配额满 / 隐私模式禁用）会静默丢数据，
// 用 toast 提醒一次即可，避免每条消息都刷屏。
let lastStorageWarnAt = 0;
function warnStorage(name: string, err: unknown): void {
    console.error(`[keyStore] 写入 ${name} 失败`, err);
    const now = Date.now();
    if (now - lastStorageWarnAt > 10_000) {
        lastStorageWarnAt = now;
        toast.error("本地存储失败（可能已满）", { description: "私钥/链头可能未保存，建议导出备份或清空旧好友" });
    }
}

// ---------- 读取 / 写入 ----------

function readRawTuples(myId: string): FriendKeyTuple[] {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return [];
        const all = JSON.parse(raw) as Record<string, FriendKeyTuple[]>;
        return all[myId] ?? [];
    } catch {
        return [];
    }
}

function writeRawTuples(myId: string, tuples: FriendKeyTuple[]): void {
    let all: Record<string, FriendKeyTuple[]> = {};
    try {
        const raw = localStorage.getItem(STORE_KEY);
        all = raw ? JSON.parse(raw) : {};
    } catch {
        all = {};
    }
    all[myId] = tuples;
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (err) {
        warnStorage(STORE_KEY, err);
    }
}

function readHeads(myId: string): Record<string, string> {
    try {
        const raw = localStorage.getItem(HEADS_KEY);
        if (!raw) return {};
        const all = JSON.parse(raw) as Record<string, Record<string, string>>;
        return all[myId] ?? {};
    } catch {
        return {};
    }
}

function writeHeads(myId: string, heads: Record<string, string>): void {
    let all: Record<string, Record<string, string>> = {};
    try {
        const raw = localStorage.getItem(HEADS_KEY);
        all = raw ? JSON.parse(raw) : {};
    } catch {
        all = {};
    }
    all[myId] = heads;
    try {
        localStorage.setItem(HEADS_KEY, JSON.stringify(all));
    } catch (err) {
        warnStorage(HEADS_KEY, err);
    }
}

const headKey = (friendId: string, novicode: string) => `${friendId}|${novicode}`;

const emptyJwk = (): JsonWebKey => ({} as JsonWebKey);

/** 确保 vault 可用：无 vault 时自动创建（无密码，仅本浏览器内加密），已存在则需已解锁 */
async function ensureVault(myId: string): Promise<void> {
    if (isVaultUnlocked(myId)) return;
    if (vaultStatus(myId) === "none") {
        await setupVault(myId, "");
        return;
    }
    throw new Error("保险箱已存在但未解锁，无法保存密钥");
}

// ---------- 5 元组操作（同步读，vault 解锁时合并私钥） ----------

/** 取某好友某版本的 5 元组；不存在返回 null。vault 未解锁时私钥为空。 */
export function getTuple(myId: string, friendId: string, novicode: string): FriendKeyTuple | null {
    const t = readRawTuples(myId).find(t => t.friendId === friendId && t.novicode === novicode);
    if (!t) return null;
    if (!isVaultUnlocked(myId)) {
        return { ...t, ownPrivateKey: emptyJwk() };
    }
    return t;
}

/** 列出某好友的全部代次 5 元组 */
export function listTuplesForFriend(myId: string, friendId: string): FriendKeyTuple[] {
    const tuples = readRawTuples(myId).filter(t => t.friendId === friendId);
    if (!isVaultUnlocked(myId)) {
        return tuples.map(t => ({ ...t, ownPrivateKey: emptyJwk() }));
    }
    return tuples;
}

// ---------- 异步写操作（需 vault 解锁以加密私钥） ----------

/** 保存/更新某好友某版本的 5 元组。私钥经 vault 加密存储。 */
export async function saveTuple(myId: string, tuple: FriendKeyTuple): Promise<void> {
    await ensureVault(myId);

    const tuples = readRawTuples(myId);
    const idx = tuples.findIndex(t => t.friendId === tuple.friendId && t.novicode === tuple.novicode);
    if (idx >= 0) tuples[idx] = tuple;
    else tuples.push(tuple);
    writeRawTuples(myId, tuples);

    const secrets = new Map<string, JsonWebKey>();
    for (const t of tuples) {
        if (t.ownPrivateKey && t.ownPrivateKey.n) {
            secrets.set(envelopeKeyFor(t.friendId, t.novicode), t.ownPrivateKey);
        }
    }
    await writeSecrets(myId, secrets);
}

/**
 * 补齐某好友某版本的 5 元组：已有则只补缺的公钥；
 * 没有则要求 ownPriv/ownPub 已就位（本端生成过）后再补 friendPublicKey。
 * 用于收到好友申请/接受推送时把对方公钥填进来。
 */
export async function mergeFriendPublicKey(
    myId: string,
    friendId: string,
    novicode: string,
    friendPublicKey: JsonWebKey,
    ownPrivateKey?: JsonWebKey,
    ownPublicKey?: JsonWebKey
): Promise<FriendKeyTuple | null> {
    await ensureVault(myId);

    const existing = readRawTuples(myId).find(t => t.friendId === friendId && t.novicode === novicode);
    if (existing) {
        const updated: FriendKeyTuple = { ...existing, friendPublicKey };
        const tuples = readRawTuples(myId);
        const idx = tuples.findIndex(t => t.friendId === friendId && t.novicode === novicode);
        tuples[idx] = updated;
        writeRawTuples(myId, tuples);
        return updated;
    }
    if (!ownPrivateKey || !ownPublicKey) return null;
    const tuple: FriendKeyTuple = {
        friendId,
        novicode,
        ownPrivateKey,
        ownPublicKey,
        friendPublicKey,
    };
    await saveTuple(myId, tuple);
    return tuple;
}

/** 删除某好友的全部 5 元组与链头（解除好友关系时调用，尽量无痕） */
export async function removeFriendKeys(myId: string, friendId: string): Promise<void> {
    writeRawTuples(myId, readRawTuples(myId).filter(t => t.friendId !== friendId));
    const heads = readHeads(myId);
    for (const k of Object.keys(heads)) {
        if (k.startsWith(`${friendId}|`)) delete heads[k];
    }
    writeHeads(myId, heads);

    if (vaultStatus(myId) !== "none") {
        await ensureVault(myId);
        const secrets = new Map<string, JsonWebKey>();
        for (const t of readRawTuples(myId)) {
            if (t.ownPrivateKey && t.ownPrivateKey.n && t.friendId !== friendId) {
                secrets.set(envelopeKeyFor(t.friendId, t.novicode), t.ownPrivateKey);
            }
        }
        await writeSecrets(myId, secrets);
    }
}

/** 删除某代次的 5 元组 */
export async function deleteTuple(myId: string, friendId: string, novicode: string): Promise<void> {
    writeRawTuples(myId, readRawTuples(myId).filter(t => !(t.friendId === friendId && t.novicode === novicode)));
    if (vaultStatus(myId) !== "none") {
        await ensureVault(myId);
        const secrets = new Map<string, JsonWebKey>();
        for (const t of readRawTuples(myId)) {
            if (t.ownPrivateKey && t.ownPrivateKey.n) {
                secrets.set(envelopeKeyFor(t.friendId, t.novicode), t.ownPrivateKey);
            }
        }
        await writeSecrets(myId, secrets);
    }
}

/** 删除某代次的链头（novicode 重贴标签时用） */
export function deleteChainHead(myId: string, friendId: string, novicode: string): void {
    const heads = readHeads(myId);
    delete heads[headKey(friendId, novicode)];
    writeHeads(myId, heads);
}

// ---------- 链头操作（明文，无需 vault） ----------

/** 取链头（上一条 currHash）；无则返回创世值 */
export function getChainHead(myId: string, friendId: string, novicode: string): string {
    return readHeads(myId)[headKey(friendId, novicode)] ?? GENESIS_PRE_HASH;
}

/** 更新链头为某条消息的 currHash */
export function setChainHead(myId: string, friendId: string, novicode: string, currHash: string): void {
    const heads = readHeads(myId);
    heads[headKey(friendId, novicode)] = currHash;
    writeHeads(myId, heads);
}

// ---------- 导出 / 导入备份 ----------

/** 导出当前用户的全部密钥 + 链头为可下载 JSON（需 vault 已解锁） */
export async function exportKeys(myId: string): Promise<KeyBundle> {
    const secrets = await readSecrets(myId);
    const tuples = readRawTuples(myId).map(t => {
        const priv = secrets.get(envelopeKeyFor(t.friendId, t.novicode));
        return priv ? { ...t, ownPrivateKey: priv } : t;
    });
    return {
        myId,
        tuples,
        chainHeads: readHeads(myId),
    };
}

/** 下载导出文件 */
export async function downloadKeysBackup(myId: string): Promise<void> {
    const bundle = await exportKeys(myId);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `novi-keys-${myId}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/** 导入备份（合并：不覆盖已存在的同 (friendId,novicode) 元组，除非本地缺失） */
export async function importKeysBackup(bundle: KeyBundle): Promise<void> {
    const myId = bundle.myId;
    if (vaultStatus(myId) !== "none") await ensureVault(myId);
    const existing = readRawTuples(myId);
    const heads = readHeads(myId);
    let changed = false;

    for (const t of bundle.tuples) {
        const idx = existing.findIndex(e => e.friendId === t.friendId && e.novicode === t.novicode);
        if (idx < 0) {
            existing.push(t);
            changed = true;
        }
    }
    writeRawTuples(myId, existing);

    for (const [k, v] of Object.entries(bundle.chainHeads ?? {})) {
        if (!(k in heads)) {
            heads[k] = v;
            changed = true;
        }
    }
    writeHeads(myId, heads);

    if (changed && vaultStatus(myId) !== "none") {
        const secrets = new Map<string, JsonWebKey>();
        for (const t of existing) {
            if (t.ownPrivateKey && t.ownPrivateKey.n) {
                secrets.set(envelopeKeyFor(t.friendId, t.novicode), t.ownPrivateKey);
            }
        }
        await writeSecrets(myId, secrets);
    }
}

/** 删除当前用户的全部密钥与链头（清空本地密钥） */
export function clearKeys(myId: string): void {
    let allTuples: Record<string, FriendKeyTuple[]> | null = null;
    try {
        const rawTuples = localStorage.getItem(STORE_KEY);
        allTuples = rawTuples ? JSON.parse(rawTuples) : null;
    } catch {
        allTuples = null;
    }
    if (allTuples) delete allTuples[myId];
    try {
        if (allTuples && Object.keys(allTuples).length > 0) localStorage.setItem(STORE_KEY, JSON.stringify(allTuples));
        else localStorage.removeItem(STORE_KEY);

        let allHeads: Record<string, Record<string, string>> | null = null;
        const rawHeads = localStorage.getItem(HEADS_KEY);
        allHeads = rawHeads ? JSON.parse(rawHeads) : null;
        if (allHeads) delete allHeads[myId];
        if (allHeads && Object.keys(allHeads).length > 0) localStorage.setItem(HEADS_KEY, JSON.stringify(allHeads));
        else localStorage.removeItem(HEADS_KEY);
    } catch (err) {
        warnStorage(STORE_KEY, err);
    }

    clearVault(myId);
}

/** 解析并校验备份文件内容 */
export function parseKeysBackup(text: string): KeyBundle {
    const obj = JSON.parse(text) as KeyBundle;
    if (!obj.myId || !Array.isArray(obj.tuples)) throw new Error("备份文件格式不正确");
    return obj;
}

// ---------- 迁移：将存量明文私钥迁入 vault ----------

/**
 * 将 localStorage 中明文私钥加密迁入 vault（一次性迁移）。
 * 调用方需先确保 vault 已解锁或已建（见 VaultContext 启动流程）。
 * 返回是否执行了迁移（false 表示无需迁移：无私钥）。
 */
export async function migratePlaintextKeys(myId: string): Promise<boolean> {
    const rawTuples = readRawTuples(myId);
    const hasPlaintextPriv = rawTuples.some(t => t.ownPrivateKey && t.ownPrivateKey.n);
    if (!hasPlaintextPriv) return false;
    const secrets = new Map<string, JsonWebKey>();
    for (const t of rawTuples) {
        if (t.ownPrivateKey && t.ownPrivateKey.n) {
            secrets.set(envelopeKeyFor(t.friendId, t.novicode), t.ownPrivateKey);
        }
    }
    await writeSecrets(myId, secrets);
    const scrubbed = rawTuples.map(t => {
        if (t.ownPrivateKey && t.ownPrivateKey.n) {
            return { ...t, ownPrivateKey: emptyJwk() };
        }
        return t;
    });
    writeRawTuples(myId, scrubbed);
    return true;
}

/** 检查是否有存量明文私钥需要迁移 */
export function hasPlaintextKeys(myId: string): boolean {
    return readRawTuples(myId).some(t => t.ownPrivateKey && t.ownPrivateKey.n);
}
