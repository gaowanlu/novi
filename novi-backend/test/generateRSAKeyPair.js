import { generateKeyPairSync } from 'crypto';

// 封装生成 RSA 密钥对函数
function generateRSAKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048, // 密钥长度（2048位足够安全）
        publicKeyEncoding: {
            type: 'spki',       // 推荐使用 spki 格式
            format: 'pem',
        },
        privateKeyEncoding: {
            type: 'pkcs8',      // 推荐使用 pkcs8 格式
            format: 'pem',
        },
    });

    return { publicKey, privateKey };
}

// 生成两对密钥
const userAKeys = generateRSAKeyPair();
const userBKeys = generateRSAKeyPair();

// 打印结果
console.log('用户A 公钥:\n', userAKeys.publicKey);
console.log('用户A 私钥:\n', userAKeys.privateKey);
console.log('用户B 公钥:\n', userBKeys.publicKey);
console.log('用户B 私钥:\n', userBKeys.privateKey);
