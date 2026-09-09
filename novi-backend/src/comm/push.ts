import logger from '../logger.js'
import { noviNodeIPC } from '../mq/noviNodeIPC.js'
import { redisClient } from '../db/dbRedis.js'
import type { RedisClientType } from 'redis'

/**
 * 推送消息给一组在线用户
 * 流程：批量读 redis 取各用户在线所在节点（一次 pipeline）-> 按节点去重 -> 通过节点间消息队列发往对应节点 -> 由该节点推送给本地 socket
 * 离线用户静默跳过；单个用户推送失败不影响其它用户
 * @param userIds - 目标用户ID列表（内部先去重，调用方可直接传 flatMap 产生的含重复数组）
 * @param event - Socket.IO 事件名
 * @param message - 推送内容（对象或数组，经 JSON 序列化后随节点消息传输）
 */
export async function pushToUsers(userIds: string[], event: string, message: object | object[]): Promise<void> {
    // 去重：markreaded/cryptoAck 的 flatMap 会产生大量重复 sender/receiver，先去重再批量读
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;

    // 批量读在线节点：一次 multi 拿全部，避免 N 个用户 N 次独立 RTT。
    // redisClient 由 createClient() 创建（返回 RedisClient），转成 RedisClientType 以满足类型。
    const client = redisClient as unknown as RedisClientType;
    const multi = client.multi();
    for (const userId of unique) {
        multi.get(`user:online:${userId}`);
    }
    const results = (await multi.exec()) as unknown as (string | null)[];

    // 按目标节点去重：同一节点只发一条 IPC（该节点自行 fan-out 到本地 socket）
    const targetNodes = new Set<string>();
    for (let i = 0; i < unique.length; i++) {
        const node = results[i];
        if (!node) continue; // 离线用户静默跳过
        targetNodes.add(node);
    }
    if (targetNodes.size === 0) return;

    const msg = noviNodeIPC.createNewMessage(unique[0], event, message);
    if (!msg) return;

    await Promise.allSettled([...targetNodes].map((node) => {
        noviNodeIPC.sendToNode(node, msg);
    }));
}

/**
 * 推送失败时的统一日志（各调用点捕获异常后使用）
 */
export function logPushError(event: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error(`[push] ${event} 推送异常: ${e.message}`);
}
