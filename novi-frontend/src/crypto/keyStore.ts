/**
 * novi 客户端密钥存储（用户自管，平台不持有）
 *
 * 为每个 (myId, friendId, novicode) 维护一个 5 元组：
 *   { friendId, novicode, ownPrivateKey(JWK), ownPublicKey(JWK), friendPublicKey(JWK) }
 * 另为每个链维护链头 currHash（首条为创世值）。
 *
 * 存储：localStorage（明文 JWK）。提供导出/导入 JSON 备份，私钥丢失时可恢复。
 * 注意：私钥以 JWK 明文存本地，可被同机恶意脚本读取；导出文件需用户自行妥善保管。
 */
import { GENESIS_PRE_HASH } from "./crypto.js";

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

// ---------- 读取 / 写入 ----------

function readTuples(myId: string): FriendKeyTuple[] {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return [];
        const all = JSON.parse(raw) as Record<string, FriendKeyTuple[]>;
        return all[myId] ?? [];
    } catch {
        return [];
    }
}

function writeTuples(myId: string, tuples: FriendKeyTuple[]): void {
    const raw = localStorage.getItem(STORE_KEY);
    const all: Record<string, FriendKeyTuple[]> = raw ? JSON.parse(raw) : {};
    all[myId] = tuples;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
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
    const raw = localStorage.getItem(HEADS_KEY);
    const all: Record<string, Record<string, string>> = raw ? JSON.parse(raw) : {};
    all[myId] = heads;
    localStorage.setItem(HEADS_KEY, JSON.stringify(all));
}

const headKey = (friendId: string, novicode: string) => `${friendId}|${novicode}`;

// ---------- 5 元组操作 ----------

/** 取某好友某版本的 5 元组；不存在返回 null */
export function getTuple(myId: string, friendId: string, novicode: string): FriendKeyTuple | null {
    return readTuples(myId).find(t => t.friendId === friendId && t.novicode === novicode) ?? null;
}

/** 保存/更新某好友某版本的 5 元组 */
export function saveTuple(myId: string, tuple: FriendKeyTuple): void {
    const tuples = readTuples(myId);
    const idx = tuples.findIndex(t => t.friendId === tuple.friendId && t.novicode === tuple.novicode);
    if (idx >= 0) tuples[idx] = tuple;
    else tuples.push(tuple);
    writeTuples(myId, tuples);
}

/**
 * 补齐某好友某版本的 5 元组：已有则只补缺的公钥；
 * 没有则要求 ownPriv/ownPub 已就位（本端生成过）后再补 friendPublicKey。
 * 用于收到好友申请/接受推送时把对方公钥填进来。
 */
export function mergeFriendPublicKey(
    myId: string,
    friendId: string,
    novicode: string,
    friendPublicKey: JsonWebKey,
    ownPrivateKey?: JsonWebKey,
    ownPublicKey?: JsonWebKey
): FriendKeyTuple | null {
    const existing = getTuple(myId, friendId, novicode);
    if (existing) {
        const updated: FriendKeyTuple = { ...existing, friendPublicKey };
        saveTuple(myId, updated);
        return updated;
    }
    if (!ownPrivateKey || !ownPublicKey) return null; // 本端还没生成密钥
    const tuple: FriendKeyTuple = {
        friendId,
        novicode,
        ownPrivateKey,
        ownPublicKey,
        friendPublicKey,
    };
    saveTuple(myId, tuple);
    return tuple;
}

/** 删除某好友的全部 5 元组与链头（解除好友关系时调用，尽量无痕） */
export function removeFriendKeys(myId: string, friendId: string): void {
    writeTuples(myId, readTuples(myId).filter(t => t.friendId !== friendId));
    const heads = readHeads(myId);
    for (const k of Object.keys(heads)) {
        if (k.startsWith(`${friendId}|`)) delete heads[k];
    }
    writeHeads(myId, heads);
}

/** 列出某好友的全部代次 5 元组 */
export function listTuplesForFriend(myId: string, friendId: string): FriendKeyTuple[] {
    return readTuples(myId).filter(t => t.friendId === friendId);
}

/** 删除某代次的 5 元组 */
export function deleteTuple(myId: string, friendId: string, novicode: string): void {
    writeTuples(myId, readTuples(myId).filter(t => !(t.friendId === friendId && t.novicode === novicode)));
}

/** 删除某代次的链头（novicode 重贴标签时用） */
export function deleteChainHead(myId: string, friendId: string, novicode: string): void {
    const heads = readHeads(myId);
    delete heads[headKey(friendId, novicode)];
    writeHeads(myId, heads);
}

// ---------- 链头操作 ----------

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

/** 导出当前用户的全部密钥 + 链头为可下载 JSON */
export function exportKeys(myId: string): KeyBundle {
    return {
        myId,
        tuples: readTuples(myId),
        chainHeads: readHeads(myId),
    };
}

/** 下载导出文件 */
export function downloadKeysBackup(myId: string): void {
    const bundle = exportKeys(myId);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `novi-keys-${myId}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/** 导入备份（合并：不覆盖已存在的同 (friendId,novicode) 元组，除非本地缺失） */
export function importKeysBackup(bundle: KeyBundle): void {
    const myId = bundle.myId;
    for (const t of bundle.tuples) {
        if (!getTuple(myId, t.friendId, t.novicode)) saveTuple(myId, t);
    }
    const heads = readHeads(myId);
    for (const [k, v] of Object.entries(bundle.chainHeads ?? {})) {
        if (!(k in heads)) heads[k] = v;
    }
    writeHeads(myId, heads);
}

/** 解析并校验备份文件内容 */
export function parseKeysBackup(text: string): KeyBundle {
    const obj = JSON.parse(text) as KeyBundle;
    if (!obj.myId || !Array.isArray(obj.tuples)) throw new Error("备份文件格式不正确");
    return obj;
}
