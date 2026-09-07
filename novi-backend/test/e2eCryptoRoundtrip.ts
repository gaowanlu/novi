/**
 * E2E 混合加密 + RSA-PSS 签名 + 链式 hash 的 Node 端参考自检。
 *
 * 用途：验证前端 WebCrypto 所用的算法参数（RSA-PSS/SHA-256/salt32、RSA-OAEP/SHA-1、
 * AES-256-GCM、链 hash 计算）在 Node 端可完整往返，作为前后端互操作的基准。
 * 运行：npx tsx test/e2eCryptoRoundtrip.ts
 *
 * 注意：这不是单元测试（项目无测试运行器），仅手动验证。
 * 前端用 WebCrypto、本脚本用 Node crypto，两者参数必须一致（见 crypto.ts 注释）。
 */
import {
    generateKeyPairSync,
    createSign,
    createVerify,
    privateDecrypt,
    publicEncrypt,
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    constants
} from 'crypto';

const toHex = (b: Buffer) => b.toString('hex');
const bufToB64 = (b: Buffer) => b.toString('base64');
const b64ToBuf = (s: string) => Buffer.from(s, 'base64');

// ---------- 生成两对 RSA 密钥（A=发送者, B=接收者） ----------
// 用普通 'rsa' 而非 'rsa-pss'：Node 26+ 的 generateKeyPairSync 不再接受 hash/saltLength
// 生成期参数。算法参数改在每次操作时显式指定（PSS padding+saltLength / OAEP sha1），
// 与前端 WebCrypto 的实际用法一致，往返自检结论不变。
function genRsaPss(): { pubPem: string; privPem: string } {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicExponent: 0x10001,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { pubPem: publicKey as string, privPem: privateKey as string };
}

const A = genRsaPss(); // 发送者
const B = genRsaPss(); // 接收者

// ---------- 发送方：构造 + 签名 + 链 + 混合加密 ----------
// 数据密钥被 OAEP 包装两次：wrappedKey→接收方(B)公钥、wrappedKeySelf→发送方(A)自己公钥，
// 两份封装同一个 dataKey。接收方用 B 私钥解 wrappedKey；发送方用 A 私钥解 wrappedKeySelf
// 回读自己的历史消息（修复「刷新后自己消息无法恢复」）。
function senderBuild(text: string, preHash: string): {
    content: string; iv: string; wrappedKey: string; wrappedKeySelf: string; sig: string; preHash: string; currHash: string;
} {
    // 规范载荷（键序固定：v,sid,rid,text,t,pre）
    const payload = { v: '1', sid: 'senderA', rid: 'receiverB', text, t: Date.now(), pre: preHash };
    const canon = Buffer.from(JSON.stringify(payload), 'utf8');

    // 1) RSA-PSS 签名（SHA-256, salt 32）
    const signer = createSign('RSA-SHA256');
    signer.update(canon);
    const sig = signer.sign({
        key: A.privPem,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
    });

    // 2) 本条 hash = sha256(canon || sig)
    const chainInput = Buffer.concat([canon, sig]);
    const currHash = toHex(createHash('sha256').update(chainInput).digest());

    // 3) 混合加密：AES-256-GCM 加密 canon，RSA-OAEP 包装数据密钥
    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    const ct = Buffer.concat([cipher.update(canon), cipher.final()]);
    // WebCrypto 的 subtle.encrypt 会把 16 字节 auth tag 追加在密文末尾，Node 端必须对齐
    const content = Buffer.concat([ct, cipher.getAuthTag()]);
    // 接收方(B)解包用
    const wrappedKey = publicEncrypt(
        { key: B.pubPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
        dataKey
    );
    // 发送方(A)自己回读用：同一 dataKey 再封装一份给自己公钥
    const wrappedKeySelf = publicEncrypt(
        { key: A.pubPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
        dataKey
    );

    return {
        content: bufToB64(content),
        iv: bufToB64(iv),
        wrappedKey: bufToB64(wrappedKey),
        wrappedKeySelf: bufToB64(wrappedKeySelf),
        sig: bufToB64(sig),
        preHash,
        currHash,
    };
}

// ---------- 发送方自我解密：回读自己的历史消息（用 A 私钥解 wrappedKeySelf + A 公钥验签） ----------
function selfVerify(msg: ReturnType<typeof senderBuild>, expectedPre: string): {
    ok: boolean; text: string | null; currHash: string | null; reason?: string;
} {
    try {
        const dataKey = privateDecrypt(
            { key: A.privPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
            b64ToBuf(msg.wrappedKeySelf)
        );
        const raw = b64ToBuf(msg.content);
        const decipher = createDecipheriv('aes-256-gcm', dataKey, b64ToBuf(msg.iv));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        const canon = Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]);

        const verifier = createVerify('RSA-SHA256');
        verifier.update(canon);
        const ok = verifier.verify(
            { key: A.pubPem, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
            b64ToBuf(msg.sig)
        );
        if (!ok) return { ok: false, text: null, currHash: null, reason: 'signature' };

        const payload = JSON.parse(canon.toString('utf8'));
        if (payload.pre !== expectedPre) {
            return { ok: false, text: null, currHash: null, reason: 'chain' };
        }
        const chainInput = Buffer.concat([canon, b64ToBuf(msg.sig)]);
        const currHash = toHex(createHash('sha256').update(chainInput).digest());
        return { ok: true, text: payload.text, currHash };
    } catch {
        return { ok: false, text: null, currHash: null, reason: 'decrypt' };
    }
}

// ---------- 接收方：解密 + 验签 + 链校验 ----------
function receiverVerify(msg: ReturnType<typeof senderBuild>, expectedPre: string): {
    ok: boolean; text: string | null; currHash: string | null; reason?: string;
} {
    try {
        // 1) 解出数据密钥
        const dataKey = privateDecrypt(
            { key: B.privPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
            b64ToBuf(msg.wrappedKey)
        );
        // 2) AES-GCM 解密（content = 密文 || 16字节 auth tag，与 WebCrypto 对齐）
        const raw = b64ToBuf(msg.content);
        const decipher = createDecipheriv('aes-256-gcm', dataKey, b64ToBuf(msg.iv));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        const canon = Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]);

        // 3) 验签（用 createVerify，避免 Node 26 新版 crypto.verify 的参数位偏移）
        const verifier = createVerify('RSA-SHA256');
        verifier.update(canon);
        const ok = verifier.verify(
            { key: A.pubPem, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
            b64ToBuf(msg.sig)
        );
        if (!ok) return { ok: false, text: null, currHash: null, reason: 'signature' };

        // 4) 链校验
        const payload = JSON.parse(canon.toString('utf8'));
        if (payload.pre !== expectedPre) {
            return { ok: false, text: null, currHash: null, reason: 'chain' };
        }

        // 5) 重算 currHash
        const chainInput = Buffer.concat([canon, b64ToBuf(msg.sig)]);
        const currHash = toHex(createHash('sha256').update(chainInput).digest());
        return { ok: true, text: payload.text, currHash };
    } catch {
        return { ok: false, text: null, currHash: null, reason: 'decrypt' };
    }
}

// ---------- 自检 ----------
const GENESIS = '0'.repeat(64);

console.log('=== 第 1 条消息（创世） ===');
const m1 = senderBuild('你好，我是A！', GENESIS);
console.log('currHash:', m1.currHash);
const r1 = receiverVerify(m1, GENESIS);
console.log('解密:', r1.text, '| ok:', r1.ok, '| 重算currHash一致:', r1.currHash === m1.currHash);

console.log('\n=== 第 2 条消息（链式，pre=第1条currHash） ===');
const m2 = senderBuild('收到！你好A，我是B的回复。', m1.currHash);
const r2 = receiverVerify(m2, m1.currHash);
console.log('解密:', r2.text, '| ok:', r2.ok, '| 链校验:', r2.ok ? '通过' : r2.reason);

console.log('\n=== 自我解密测试：发送方 A 用 wrappedKeySelf 回读自己的历史消息（刷新后场景） ===');
const s1 = selfVerify(m1, GENESIS);
const s2 = selfVerify(m2, m1.currHash);
console.log('m1 回读:', s1.text, '| ok:', s1.ok, s1.ok ? '' : `| ${s1.reason}`);
console.log('m2 回读:', s2.text, '| ok:', s2.ok, s2.ok ? '' : `| ${s2.reason}`);
console.log('重算currHash一致:', s1.currHash === m1.currHash && s2.currHash === m2.currHash);
if (!s1.ok || !s2.ok) throw new Error('自我解密失败：发送方无法回读自己的消息');

console.log('\n=== 篡改测试：改 content 后应被拒（GCM auth tag 先于签名发现密文被改） ===');
const tampered = { ...m2 };
// 破坏密文最后一个字符
const c = Buffer.from(tampered.content, 'base64');
c[c.length - 1] ^= 0xff;
tampered.content = c.toString('base64');
const rt = receiverVerify(tampered, m1.currHash);
console.log('结果:', rt.ok ? '❌ 意外通过' : `✅ 被拒（${rt.reason}）`);

console.log('\n=== 链断裂测试：用错误 pre 应链校验失败 ===');
const rChain = receiverVerify(m2, 'f'.repeat(64));
console.log('结果:', rChain.ok ? '❌ 意外通过' : `✅ 被拒（${rChain.reason}）`);

console.log('\n=== 删除中间消息测试：第3条 pre 指向第2条，但本地链头停在第1条 ===');
const m3 = senderBuild('第三条', m2.currHash);
const rDel = receiverVerify(m3, m1.currHash); // 假装第2条被删，链头还停在 m1
console.log('结果:', rDel.ok ? '❌ 意外通过' : `✅ 被拒（${rDel.reason}）`);

console.log('\n全部自检完成。');
