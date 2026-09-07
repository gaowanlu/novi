/**
 * novi 端到端加密（WebCrypto）
 *
 * 设计（见 novi-backend/docs/plan.md）：
 *  - 每段友谊一个 novicode（密钥版本）。客户端为每个好友维护 5 元组
 *    { friendId, novicode, ownPrivateKey, ownPublicKey, friendPublicKey }，只存本地。
 *  - 消息用「RSA-PSS 签名 + AES-256-GCM 数据加密 + RSA-OAEP 包装数据密钥」的混合结构，
 *    并把对话像区块链一样用 prev-hash 串起来：每条消息嵌上一条的 currHash。
 *  - 平台只存密文/hash/签名，永远拿不到密钥，也读不到明文。
 *
 * 算法参数（WebCrypto 与后端 Node crypto 必须一致）：
 *  - 签名：RSA-PSS，SHA-256，saltLength=32
 *  - 密钥包装：RSA-OAEP，SHA-1（WebCrypto 默认）
 *  - 数据加密：AES-256-GCM，IV 12 字节
 */

// ---------- 基础字节工具 ----------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Uint8Array -> base64（分块避免 call-stack 溢出） */
export function bufToBase64(bytes: Uint8Array): string {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

/** base64 -> Uint8Array */
export function base64ToBuf(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/** 任意字节 -> hex */
export function bufToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 哈希（hex） */
export async function sha256Hex(data: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
    return bufToHex(new Uint8Array(digest));
}

/** 首条消息的创世 prevHash（64 个 0） */
export const GENESIS_PRE_HASH = "0".repeat(64);

// ---------- JWK <-> base64 ----------

/** JWK 对象 -> base64(规范 JSON 字节)。键序固定，保证两端指纹一致。 */
export function jwkToB64(jwk: JsonWebKey): string {
    // 规范序列化：固定键序，避免不同实现键序不同导致指纹不一致
    const keys = ["kty", "e", "n", "alg", "use"];
    const ordered: Record<string, unknown> = {};
    for (const k of keys) if (jwk[k as keyof JsonWebKey] !== undefined) ordered[k] = jwk[k as keyof JsonWebKey];
    // 保留其余键（按字母序）
    for (const k of Object.keys(jwk).sort()) if (!(k in ordered)) ordered[k] = jwk[k as keyof JsonWebKey];
    return bufToBase64(encoder.encode(JSON.stringify(ordered)));
}

/** base64(规范 JSON 字节) -> JWK 对象（剥掉 alg/key_ops，见 stripJwkOps） */
export function b64ToJwk(b64: string): JsonWebKey {
    return stripJwkOps(JSON.parse(decoder.decode(base64ToBuf(b64))));
}

/**
 * 公钥指纹：对公钥 JWK 的规范 JSON 字节取 SHA-256，取前 16 hex 字符，
 * 格式化成 4 组 4 位（XXXX-XXXX-XXXX-XXXX），供用户线下手动核对（防中间人）。
 */
export async function publicFingerprint(pubJwkB64: string): Promise<string> {
    const jwk = b64ToJwk(pubJwkB64);
    const hex = await sha256Hex(encoder.encode(JSON.stringify(orderJwk(jwk))));
    const head = hex.slice(0, 16);
    return head.match(/.{4}/g)!.join("-");
}

function orderJwk(jwk: JsonWebKey): Record<string, unknown> {
    // 先剥掉 alg/key_ops：指纹只对「纯密钥材料」取哈希，这样即使某端手里是修复前
    // 存下的「脏」JWK，双方对同一公钥算出的指纹仍一致（否则 alg/key_ops 会污染指纹）。
    const clean = stripJwkOps(jwk);
    const keys = ["kty", "e", "n", "use"];
    const ordered: Record<string, unknown> = {};
    for (const k of keys) if (clean[k as keyof JsonWebKey] !== undefined) ordered[k] = clean[k as keyof JsonWebKey];
    for (const k of Object.keys(clean).sort()) if (!(k in ordered)) ordered[k] = clean[k as keyof JsonWebKey];
    return ordered;
}

// ---------- 密钥生成 / 导入导出 ----------

export interface RsaKeyPair {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
    privateKeyJwk: JsonWebKey;
}

/** 生成 RSA-PSS 2048 密钥对（签名/验签用）。私钥导出为 JWK 以便本地备份。 */
export async function generateRsaKeyPair(): Promise<RsaKeyPair> {
    const pair = (await crypto.subtle.generateKey(
        {
            name: "RSA-PSS",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true, // 可导出（本地备份用）
        ["sign", "verify"]
    )) as CryptoKeyPair;

    // exportKey("jwk") 会把当时的 algorithm/usages 烤进 alg/key_ops（见 stripJwkOps）。
    // 同一对密钥还要复用给 RSA-OAEP，导出时就剥掉，使「存本地 / 走线路」的 JWK 从源头干净。
    const publicKeyJwk = stripJwkOps(await crypto.subtle.exportKey("jwk", pair.publicKey));
    const privateKeyJwk = stripJwkOps(await crypto.subtle.exportKey("jwk", pair.privateKey));
    return { ...pair, publicKeyJwk, privateKeyJwk };
}

/**
 * 去掉 JWK 里的 `alg` / `key_ops` 元数据，只保留纯密钥材料。
 *
 * 根因（加好友后发消息报 Web Crypto 错、无法通信）：
 *   `generateRsaKeyPair` 用 `exportKey("jwk")` 导出时，WebCrypto 会把该密钥当时的
 *   algorithm（RSA-PSS）与 usages（sign/verify）烤进 JWK 的 `alg` 与 `key_ops` 字段。
 *   可同一对 RSA 密钥既要当 **RSA-PSS**（签名/验签）、又要当 **RSA-OAEP**（包装/解包
 *   AES 数据密钥）。之后按「另一种算法 / 另一种用途」重新 `importKey` 时，烤进来的
 *   `key_ops`（公钥 `["verify"]`、私钥 `["sign"]`）与新请求的用途（encrypt/decrypt）不符，
 *   WebCrypto 直接抛错——
 *     Chrome:  `The JWK "key_ops" member was inconsistent ...`
 *     Firefox: `Data provided to an operation does not meet requirements`
 *     Node:    `DataError: Key operations and usage mismatch`
 *   同一根因、不同浏览器措辞不同，这正是「一个用户报 A、另一个用户报 B」。
 *   去掉这两个字段后，importKey 的算法/用途以调用方显式参数为准，跨算法复用即可。
 *
 * 在「每个 import 函数」都调用它做防御性清洗：这样无论是新生成、走线路收到的、
 * 还是修复前已存进 localStorage 的「脏」JWK，都能被安全地跨算法复用。
 */
function stripJwkOps(jwk: JsonWebKey): JsonWebKey {
    const copy = { ...jwk };
    delete (copy as Record<string, unknown>).alg;
    delete (copy as Record<string, unknown>).key_ops;
    return copy;
}

/** 从 JWK 导入公钥（验签） */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "jwk", stripJwkOps(jwk),
        { name: "RSA-PSS", hash: "SHA-256" },
        false,
        ["verify"]
    );
}

/** 从 JWK 导入私钥（签名/解密） */
export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "jwk", stripJwkOps(jwk),
        { name: "RSA-PSS", hash: "SHA-256" },
        false,
        ["sign"]
    );
}

/**
 * 从 JWK 导入可解密的 RSA-OAEP 私钥。
 * RSA-PSS 与 RSA-OAEP 的私钥 JWK 相同（都是 RSA 密钥），只是算法标签不同，
 * 这里用 OAEP 算法重新导入以支持 privateDecrypt 包装密钥。
 */
export async function importOaepPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "jwk", stripJwkOps(jwk),
        { name: "RSA-OAEP", hash: "SHA-1" },
        false,
        ["decrypt"]
    );
}

/** 从 JWK 导入可加密的 RSA-OAEP 公钥 */
export async function importOaepPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "jwk", stripJwkOps(jwk),
        { name: "RSA-OAEP", hash: "SHA-1" },
        false,
        ["encrypt"]
    );
}

// ---------- 消息载荷规范 ----------

/** 规范载荷（键序固定：v,sid,rid,text,t,pre）。text 为明文正文。 */
interface Payload {
    v: string;
    sid: string;
    rid: string;
    text: string;
    t: number;
    pre: string;
}

/** 规范 JSON 字节（UTF-8）。键序由 Payload 字段声明顺序保证。 */
function canonPayload(p: Payload): Uint8Array {
    return encoder.encode(JSON.stringify(p));
}

// ---------- 发送：加密 + 签名 + 链 ----------

export interface EncryptedMessage {
    content: string;      // AES-GCM 密文 base64
    iv: string;           // base64
    wrappedKey: string;   // 用【接收方】公钥 OAEP 包装的数据密钥 base64（接收方解包用）
    wrappedKeySelf: string; // 用【发送方自己】公钥 OAEP 包装的数据密钥 base64（发送方回读自己的历史消息用）
    sig: string;          // RSA-PSS 签名 base64
    preHash: string;      // hex
    currHash: string;     // hex
}

/**
 * 构造并加密一条消息。
 *
 * 数据密钥同时被 OAEP 包装两次：一次给【接收方公钥】(friendPubKeyJwk)、一次给【发送方自己公钥】
 * (ownPubKeyJwk)，两份包装封闭的是同一个随机 AES 数据密钥。
 *   - 接收方：用【自己】私钥解出 wrappedKey → 解密；
 *   - 发送方：用【自己】私钥解出 wrappedKeySelf → 解密（刷新后回读自己历史消息的关键，
 *     修复「自己的消息刷新后显示 (自己发送) 无法恢复」——此前只包装给接收方私钥，自己永远解不开）。
 * 链 hash 只取 canon||sig，与包装无关，因此双包装不改变 currHash、不影响篡改检测。
 *
 * @param friendPubKeyJwk 接收方公钥 JWK（OAEP 包装用）
 * @param ownPrivJwk 发送方私钥 JWK（RSA-PSS 签名用）
 * @param ownPubKeyJwk 发送方公钥 JWK（OAEP 包装一份给自己，供回读）
 */
export async function encryptMessage(opts: {
    text: string;
    novicode: string;
    senderId: string;
    receiverId: string;
    preHash: string;
    friendPubKeyJwk: JsonWebKey;
    ownPrivJwk: JsonWebKey;
    ownPubKeyJwk: JsonWebKey;
}): Promise<EncryptedMessage> {
    const { text, novicode, senderId, receiverId, preHash, friendPubKeyJwk, ownPrivJwk, ownPubKeyJwk } = opts;
    const t = Date.now();

    const payload: Payload = { v: novicode, sid: senderId, rid: receiverId, text, t, pre: preHash };
    const canon = canonPayload(payload);

    // 1) 签名：RSA-PSS 对 SHA-256(canon)
    const privKey = await importPrivateKey(ownPrivJwk);
    const sigBytes = (await crypto.subtle.sign(
        { name: "RSA-PSS", saltLength: 32 },
        privKey,
        canon as BufferSource
    )) as ArrayBuffer;
    const sig = new Uint8Array(sigBytes);

    // 2) 本条 hash：sha256(canon || sig)
    const chainInput = new Uint8Array(canon.length + sig.length);
    chainInput.set(canon, 0);
    chainInput.set(sig, canon.length);
    const currHash = await sha256Hex(chainInput);

    // 3) 混合加密：随机 AES-256-GCM 数据密钥加密 canon，再用接收方公钥 OAEP 包装数据密钥
    const dataKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        dataKey,
        canon as BufferSource
    ));
    const dataKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", dataKey));

    // 接收方解包用：封装给【对方】公钥
    const friendOaepPub = await importOaepPublicKey(friendPubKeyJwk);
    const wrappedKeyBytes = new Uint8Array(await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        friendOaepPub,
        dataKeyRaw as BufferSource
    ));
    // 自己回读用：同一数据密钥再封装一份给【自己】公钥
    const selfOaepPub = await importOaepPublicKey(ownPubKeyJwk);
    const wrappedKeySelfBytes = new Uint8Array(await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        selfOaepPub,
        dataKeyRaw as BufferSource
    ));

    return {
        content: bufToBase64(ct),
        iv: bufToBase64(iv),
        wrappedKey: bufToBase64(wrappedKeyBytes),
        wrappedKeySelf: bufToBase64(wrappedKeySelfBytes),
        sig: bufToBase64(sig),
        preHash,
        currHash,
    };
}

// ---------- 接收：解密 + 验签 + 链校验 ----------

export type DecryptStatus = "ok" | "decrypt" | "signature" | "chain";

export interface DecryptResult {
    status: DecryptStatus;
    text: string | null;
    currHash: string | null; // 本条 currHash（链头更新用）
    t: number | null;
}

/**
 * 解密并校验一条消息。
 *
 * 谁在解，就用【谁的私钥】解——本函数不关心方向，调用方按方向传参即可：
 *   - 接收方解收到的消息：`wrappedKey`=对方包装给接收方的、`ownPrivJwk`=接收方私钥、`senderPubKeyJwk`=对方公钥；
 *   - 发送方回读自己的消息：`wrappedKey`=对方（自己）包装给自己的 wrappedKeySelf、`ownPrivJwk`=自己私钥、`senderPubKeyJwk`=自己公钥。
 * 验签统一用「被验证消息的发送方公钥」= `senderPubKeyJwk`。
 *
 * @param expectedPreHash 本地链头（上一条 currHash）；首条为 GENESIS_PRE_HASH
 *
 * 校验顺序：解密 → 验签 → 存储 hash 字段比对（可选） → 链（pre === expectedPreHash）。
 * 任一步失败即返回对应 status，调用方不得 crypto/ack、不得标已读。
 */
export async function decryptMessage(opts: {
    content: string;
    iv: string;
    wrappedKey: string;
    sig: string;
    preHash: string;
    ownPrivJwk: JsonWebKey;
    senderPubKeyJwk: JsonWebKey;
    expectedPreHash: string;
    // 服务端存储的 currHash 字段。若提供，则与本地重算值比对：
    // 不一致说明服务端改写了 hash 字段（密文本身可能未动），同样判为链异常。
    storedCurrHash?: string | null;
    // 跳过「pre === expectedPreHash」的链衔接校验（解密/验签/存储hash 比对仍照常执行）。
    // 用于「从历史窗口的首条」重放：其前驱不在窗口内，拿不到真正的上一条 currHash，
    // 此时只校验该消息的自洽性，不因衔接不上而误报「链断裂」。
    skipPreCheck?: boolean;
}): Promise<DecryptResult> {
    const { content, iv, wrappedKey, sig, ownPrivJwk, senderPubKeyJwk, expectedPreHash, storedCurrHash, skipPreCheck } = opts;

    try {
        // 1) 解出数据密钥
        const oaepPriv = await importOaepPrivateKey(ownPrivJwk);
        const dataKeyRaw = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            oaepPriv,
            base64ToBuf(wrappedKey) as BufferSource
        );
        const dataKey = await crypto.subtle.importKey("raw", dataKeyRaw, { name: "AES-GCM" }, false, ["decrypt"]);

        // 2) AES-GCM 解密得 canon
        const canon = new Uint8Array(await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToBuf(iv) as BufferSource },
            dataKey,
            base64ToBuf(content) as BufferSource
        ));

        // 3) 验签：RSA-PSS 对 SHA-256(canon)
        const senderPub = await importPublicKey(senderPubKeyJwk);
        const sigOk = await crypto.subtle.verify(
            { name: "RSA-PSS", saltLength: 32 },
            senderPub,
            base64ToBuf(sig) as BufferSource,
            canon as BufferSource
        );
        if (!sigOk) return { status: "signature", text: null, currHash: null, t: null };

        // 4) 链校验：payload.pre === expectedPreHash
        const payload = JSON.parse(decoder.decode(canon)) as Payload;
        // 5) 存储的 currHash 字段与重算值比对（防服务端改写 hash 字段）
        const sigBytes = base64ToBuf(sig);
        const chainInput = new Uint8Array(canon.length + sigBytes.length);
        chainInput.set(canon, 0);
        chainInput.set(sigBytes, canon.length);
        const currHash = await sha256Hex(chainInput);
        if (storedCurrHash && storedCurrHash !== currHash) {
            return { status: "chain", text: null, currHash: null, t: null };
        }
        if (!skipPreCheck && payload.pre !== expectedPreHash) {
            return { status: "chain", text: null, currHash: null, t: null };
        }

        return { status: "ok", text: payload.text, currHash, t: payload.t };
    } catch {
        // 解密失败（OAEP/AES-GCM 异常）
        return { status: "decrypt", text: null, currHash: null, t: null };
    }
}
