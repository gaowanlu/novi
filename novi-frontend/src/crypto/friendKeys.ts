/**
 * 好友关系建立时的密钥交换辅助。
 *
 * novicode = 关系代次（版本号），服务器分配：首次添加 "1"，删除后重新添加 +1；
 * 每代独立密钥对与哈希链（见 plan.md）。删除好友时本地清理该好友全部代次的密钥，
 * 重新添加会协商新代次密钥；旧代次密文用新密钥无法解密（服务器侧聊天记录已级联删除）。
 *
 * 流程（对应后端 friend 路由）：
 *  - 发起申请：本端预推导下一代号（与服务器同算法：新鲜 GET 计数 + 1），
 *    为该代生成密钥对，把公钥 base64 带进 POST /friend/request；
 *    服务器返回的代次不一致时（并发竞态）用 relabelNovicode 重贴本地元组/链头自愈。
 *  - 接受申请：本端（接收方 B）按记录代次生成密钥对，带公钥调 PUT /friend/request；
 *    响应带回双方公钥（requesterPublicKey=A, receiverPublicKey=B），双方各自补齐 5 元组。
 *  - 收到 WS 推送（novi_friend_request_processed / comming）时，若 payload 含公钥且本地缺，
 *    则用 mergeFriendPublicKey 补齐。
 *
 * 注意：saveTuple / mergeFriendPublicKey 现为 async（需 vault 加密私钥）。
 * 所有调用方必须 await。
 */
import { generateRsaKeyPair, jwkToB64, b64ToJwk } from "./crypto.js";
import {
    saveTuple,
    getTuple,
    mergeFriendPublicKey,
    setChainHead,
    getChainHead,
    listTuplesForFriend,
    deleteTuple,
    deleteChainHead,
} from "./keyStore.js";
import { GENESIS_PRE_HASH } from "./crypto.js";

/** 存量数据兜底代次（修复前所有客户端都用 "1"） */
export const DEFAULT_NOVI_CODE = "1";

/**
 * 为本端 + 某好友生成（或复用已有）novicode 密钥对。
 * 返回公钥 base64（用于放入请求体）。
 */
export async function ensureOwnKeys(
    myId: string,
    friendId: string,
    novicode: string = DEFAULT_NOVI_CODE
): Promise<string> {
    const existing = getTuple(myId, friendId, novicode);
    if (existing && existing.ownPublicKey.n) return jwkToB64(existing.ownPublicKey);

    const pair = await generateRsaKeyPair();
    await saveTuple(myId, {
        friendId,
        novicode,
        ownPrivateKey: pair.privateKeyJwk,
        ownPublicKey: pair.publicKeyJwk,
        friendPublicKey: {} as JsonWebKey,
    });
    return jwkToB64(pair.publicKeyJwk);
}

/**
 * 本端作为「发起方 A」：申请被接受后，从推送/响应/列表拉到 B 的公钥，补齐自己的 5 元组。
 * 链头只在「本次刚补齐」（此前缺对方公钥）时初始化为创世值；若 5 元组早已完整
 * （可能已发过消息、链头已推进），绝不重置，防止迟到的重复推送把链头打回创世。
 */
export async function finalizeAsRequester(
    myId: string,
    friendId: string,
    friendPublicKeyB64: string,
    novicode: string = DEFAULT_NOVI_CODE
): Promise<void> {
    if (!friendPublicKeyB64) return;
    const own = getTuple(myId, friendId, novicode);
    if (!own) return;
    const hadFriendKey = Boolean(own.friendPublicKey?.n);
    const updated = await mergeFriendPublicKey(
        myId, friendId, novicode,
        b64ToJwk(friendPublicKeyB64),
        own.ownPrivateKey, own.ownPublicKey
    );
    if (updated && !hadFriendKey) setChainHead(myId, friendId, novicode, GENESIS_PRE_HASH);
}

/**
 * 好友申请列表项形状的输入（GET /friend 与 GET /friend/request 的聚合输出）。
 * requester/receiver 既可能是聚合后的 {userId} 对象，也可能是 WS 推送的裸字符串。
 */
export interface RequestItemLike {
    status?: string;
    publicKey?: string | null;
    receiverPublicKey?: string | null;
    novicode?: string | null;
    requester?: { userId?: string | null } | string | null;
    receiver?: { userId?: string | null } | string | null;
}

const idOf = (v: { userId?: string | null } | string | null | undefined): string | null =>
    typeof v === 'string' ? v : (v?.userId ?? null);

/**
 * 离线补齐：拉取申请/好友列表后，对每条 accepted 记录，若本端 5 元组尚不完整
 * 且对方公钥已在数据里，则补齐。典型场景：A 发起申请后离线，B 接受（B 公钥已落库），
 * A 上线拉列表 → 用 receiverPublicKey 补齐，友谊链从创世值开始。
 * 幂等：isReady 则直接跳过（绝不触碰已推进的链头）。
 */
export async function completeTupleFromRequestItem(myId: string, item: RequestItemLike): Promise<void> {
    if (!item || item.status !== 'accepted') return;
    const reqId = idOf(item.requester);
    const recvId = idOf(item.receiver);
    if (!reqId || !recvId || (myId !== reqId && myId !== recvId)) return;
    const otherId = myId === reqId ? recvId : reqId;
    const novicode = resolveCurrentNovicode(myId, otherId, item.novicode ?? null);
    if (isReady(myId, otherId, novicode)) return;
    const neededPub = myId === reqId ? item.receiverPublicKey : item.publicKey;
    if (!neededPub) return;
    await finalizeAsRequester(myId, otherId, neededPub, novicode);
}

/**
 * 解析与某好友的「当前」关系代次。
 * 候选：记录 novicode（服务器权威）> 本地已有元组代次 > "1" 兜底。
 * 取数值最大者（非数字按 -1）：删除后重新添加时记录代次必大于本地任何旧代次。
 */
export function resolveCurrentNovicode(
    myId: string, friendId: string, recordNovicode?: string | null
): string {
    const candidates = new Set<string>([DEFAULT_NOVI_CODE]);
    if (recordNovicode) candidates.add(recordNovicode);
    for (const t of listTuplesForFriend(myId, friendId)) candidates.add(t.novicode);
    let best = DEFAULT_NOVI_CODE;
    let bestNum = -1;
    for (const c of candidates) {
        const n = Number(c);
        if (!Number.isNaN(n) && n > bestNum) { bestNum = n; best = c; }
    }
    return best;
}

/**
 * 自愈：把本地 5 元组与链头从一代重贴到另一代（JWK 材料不变）。
 * 场景：客户端预推导的代次与服务器分配不一致（并发竞态）→ 以服务器值为准。
 * 幂等：目标代次已有元组则保留既有、只清理旧代次。
 */
export async function relabelNovicode(
    myId: string, friendId: string, fromNovicode: string, toNovicode: string
): Promise<void> {
    if (fromNovicode === toNovicode) return;
    const t = getTuple(myId, friendId, fromNovicode);
    if (!t) return;
    if (!getTuple(myId, friendId, toNovicode)) {
        await saveTuple(myId, { ...t, novicode: toNovicode });
    }
    await deleteTuple(myId, friendId, fromNovicode);
    const fromHead = getChainHead(myId, friendId, fromNovicode);
    if (fromHead !== GENESIS_PRE_HASH && getChainHead(myId, friendId, toNovicode) === GENESIS_PRE_HASH) {
        setChainHead(myId, friendId, toNovicode, fromHead);
    }
    deleteChainHead(myId, friendId, fromNovicode);
}

/**
 * 本端作为「接收方 B」：接受申请时，生成自己的密钥对并把双方公钥都落库。
 * @param requesterPublicKeyB64 A 的公钥（申请时 A 带的，后端回显）
 * @returns B 的公钥 base64（放入 PUT 请求体）
 */
export async function finalizeAsReceiver(
    myId: string,
    friendId: string,
    requesterPublicKeyB64: string | null,
    novicode: string = DEFAULT_NOVI_CODE
): Promise<string> {
    const existedBefore = Boolean(getTuple(myId, friendId, novicode));
    const ownPubB64 = await ensureOwnKeys(myId, friendId, novicode);
    if (requesterPublicKeyB64) {
        const own = getTuple(myId, friendId, novicode)!;
        await mergeFriendPublicKey(
            myId, friendId, novicode,
            b64ToJwk(requesterPublicKeyB64),
            own.ownPrivateKey, own.ownPublicKey
        );
    }
    if (!existedBefore) setChainHead(myId, friendId, novicode, GENESIS_PRE_HASH);
    return ownPubB64;
}

/** 检查某好友某版本是否已具备完整 5 元组（双方公钥 + 本端私钥都在） */
export function isReady(myId: string, friendId: string, novicode: string = DEFAULT_NOVI_CODE): boolean {
    const t = getTuple(myId, friendId, novicode);
    return Boolean(
        t &&
        t.ownPrivateKey.n &&
        t.ownPublicKey.n &&
        t.friendPublicKey.n
    );
}
