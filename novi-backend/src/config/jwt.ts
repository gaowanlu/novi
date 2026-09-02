import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { NoviUser } from '../comm/noviUser.js';

// 集中管理 JWT 配置与签发/校验逻辑。
// 所有需要 NOVI_JWT_SECRET 的地方（auth 路由、HTTP 中间件、Socket.IO 中间件）都应从这里取值，
// 避免多处独立读取导致密钥缺失时用空串静默运行。
const rawSecret = process.env.NOVI_JWT_SECRET;
if (!rawSecret) {
    // fail-fast：缺少密钥时拒绝启动，而不是用空密钥继续运行（空密钥可被伪造令牌）
    throw new Error('NOVI_JWT_SECRET 未配置，拒绝启动');
}
// 断言为 string：上面的 throw 已保证非空，但 TS 无法跨模块级 const 收窄到调用点
const secret = rawSecret as string;

const ttl = Number.parseInt(process.env.NOVI_JWT_TOKEN_TTL ?? '3600', 10) || 3600;

export const JWT_SECRET = secret;
export const JWT_TOKEN_TTL = ttl;

/** 签发用户令牌。_id 为用户的 MongoDB ObjectId 字符串。 */
export function signToken(_id: string): string {
    // 令牌自身带过期时间，形成「JWT 过期 + Redis 吊销」双保险
    return jwt.sign({ _id }, secret, { expiresIn: `${ttl}s` });
}

/** 校验令牌签名与过期，返回解析后的载荷（含 _id）。失败抛错，由调用方处理。 */
export function verifyToken(token: string): JwtPayload & { _id: string } {
    return jwt.verify(token, secret) as unknown as JwtPayload & { _id: string };
}

export type { NoviUser };
