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
    if (existing) return jwkToB64(existing.ownPublicKey);

    const pair = await generateRsaKeyPair();
    saveTuple(myId, {
        friendId,
        novicode,
        ownPrivateKey: pair.privateKeyJwk,
        ownPublicKey: pair.publicKeyJwk,
        // friendPublicKey 占位，待对方公钥到达后 merge 进来
        friendPublicKey: {} as JsonWebKey,
    });
    return jwkToB64(pair.publicKeyJwk);
}

/**
 * 本端作为「发起方 A」：申请被接受后，从推送/响应/列表拉到 B 的公钥，补齐自己的 5 元组。
 * 链头只在「本次刚补齐」（此前缺对方公钥）时初始化为创世值；若 5 元组早已完整
 * （可能已发过消息、链头已推进），绝不重置，防止迟到的重复推送把链头打回创世。
 */
export function finalizeAsRequester(
    myId: string,
    friendId: string,
    friendPublicKeyB64: string,
    novicode: string = DEFAULT_NOVI_CODE
): void {
    if (!friendPublicKeyB64) return;
    const own = getTuple(myId, friendId, novicode);
    if (!own) return; // 本端没有密钥（异常）
    const hadFriendKey = Boolean(own.friendPublicKey?.n);
    const updated = mergeFriendPublicKey(
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
    publicKey?: string | null;          // 发起方(A)公钥（申请时已存）
    receiverPublicKey?: string | null;  // 接收方(B)公钥（接受时落库）
    novicode?: string | null;           // 关系代次（版本号），服务器分配
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
export function completeTupleFromRequestItem(myId: string, item: RequestItemLike): void {
    if (!item || item.status !== 'accepted') return;
    const reqId = idOf(item.requester);
    const recvId = idOf(item.receiver);
    if (!reqId || !recvId || (myId !== reqId && myId !== recvId)) return;
    const otherId = myId === reqId ? recvId : reqId;
    // 解析当前代次：记录 novicode（服务器权威）> 本地已有代次 > "1"
    const novicode = resolveCurrentNovicode(myId, otherId, item.novicode ?? null);
    if (isReady(myId, otherId, novicode)) return;
    // 我是发起方 → 需要接收方公钥；我是接收方 → 需要发起方公钥
    const neededPub = myId === reqId ? item.receiverPublicKey : item.publicKey;
    if (!neededPub) return;
    finalizeAsRequester(myId, otherId, neededPub, novicode);
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
export function relabelNovicode(
    myId: string, friendId: string, fromNovicode: string, toNovicode: string
): void {
    if (fromNovicode === toNovicode) return;
    const t = getTuple(myId, friendId, fromNovicode);
    if (!t) return; // 旧代次无元组（已重贴过或缺失）
    if (!getTuple(myId, friendId, toNovicode)) {
        saveTuple(myId, { ...t, novicode: toNovicode }); // 5 元组重贴到新代次
    }
    deleteTuple(myId, friendId, fromNovicode); // 必须删旧代次，否则重复元组会让 max 解析选错
    // 链头迁移（仅当新代次尚未推进，避免回退）
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
    // 记录调用前是否已有 5 元组：链头只在「首次建立」时初始化，
    // 避免重复调用把已推进的链头打回创世值。
    const existedBefore = Boolean(getTuple(myId, friendId, novicode));
    const ownPubB64 = await ensureOwnKeys(myId, friendId, novicode);
    // 把 A 的公钥 merge 进来
    if (requesterPublicKeyB64) {
        const own = getTuple(myId, friendId, novicode)!;
        mergeFriendPublicKey(
            myId, friendId, novicode,
            b64ToJwk(requesterPublicKeyB64),
            own.ownPrivateKey, own.ownPublicKey
        );
    }
    if (!existedBefore) setChainHead(myId, friendId, novicode, GENESIS_PRE_HASH);
    return ownPubB64;
}

/** 检查某好友某版本是否已具备完整 5 元组（双方公钥都在） */
export function isReady(myId: string, friendId: string, novicode: string = DEFAULT_NOVI_CODE): boolean {
    const t = getTuple(myId, friendId, novicode);
    return Boolean(
        t &&
        t.ownPrivateKey.n &&
        t.ownPublicKey.n &&
        t.friendPublicKey.n
    );
}
