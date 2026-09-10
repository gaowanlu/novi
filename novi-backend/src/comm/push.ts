import logger from '../logger.js'
import { noviNodeIPC, type NoviNodeMessage } from '../mq/noviNodeIPC.js'
import { redisClient } from '../db/dbRedis.js'
import type { RedisClientType } from 'redis'

/**
 * 推送消息给一组在线用户
 * 流程：批量读 redis 取各用户在线所在节点（一次 multi）-> 按目标节点分组（每节点一条 IPC，
 * 携带该节点上的在线用户列表）-> 发往各节点 -> 由该节点向列表内每个用户 fan-out 到本地 socket
 * 离线用户静默跳过；单个用户/节点推送失败不影响其它
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

    // 按目标节点分组：同一节点只发一条 IPC，但携带该节点上【全部】在线用户——
    // 接收端对列表内每个用户各自 emit。单 forUserId 会丢失其余用户（回归点）。
    const nodeToUsers = new Map<string, string[]>();
    for (let i = 0; i < unique.length; i++) {
        const node = results[i];
        if (!node) continue; // 离线用户静默跳过
        const list = nodeToUsers.get(node);
        if (list) list.push(unique[i]);
        else nodeToUsers.set(node, [unique[i]]);
    }
    if (nodeToUsers.size === 0) return;

    await Promise.allSettled([...nodeToUsers.entries()].map(([node, users]) => {
        const msg: NoviNodeMessage = {
            fromNode: process.env.NOVI_NODE || 'unknown',
            forUserIds: users,
            event,
            message: JSON.stringify(message),
            timestamp: Date.now(),
        };
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
