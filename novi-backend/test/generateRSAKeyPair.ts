import { generateKeyPairSync, publicEncrypt, privateDecrypt } from 'crypto';

// 生成 RSA 密钥对函数
function generateRSAKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
}

// 模拟用户 A、B 各自的密钥对
const userA = generateRSAKeyPair();
const userB = generateRSAKeyPair();

// 打印结果
console.log('用户A 公钥:\n', userA.publicKey);
console.log('用户A 私钥:\n', userA.privateKey);
console.log('用户B 公钥:\n', userB.publicKey);
console.log('用户B 私钥:\n', userB.privateKey);

// A → B：A 用 B 的公钥加密消息
const messageFromA = '你好，我是A！';
const encryptedForB = publicEncrypt(userB.publicKey, Buffer.from(messageFromA));

console.log('📨 A 加密后发给 B：', encryptedForB.toString('base64'));

// B 解密收到的消息
const decryptedByB = privateDecrypt(userB.privateKey, encryptedForB);
console.log('📬 B 解密后得到：', decryptedByB.toString());

// B → A：B 回复，用 A 的公钥加密
const messageFromB = '收到！你好A，我是B！';
const encryptedForA = publicEncrypt(userA.publicKey, Buffer.from(messageFromB));

console.log('📨 B 加密后发给 A：', encryptedForA.toString('base64'));

// A 用自己的私钥解密
const decryptedByA = privateDecrypt(userA.privateKey, encryptedForA);
console.log('📬 A 解密后得到：', decryptedByA.toString());
