import { mqKafkaInit } from './mqKafka.js'
import { mqRabbitMQInit, rabbitMQNoviNodeChannel } from './mqRabbitMQ.js'
import logger from '../logger.js'
import { userConnections } from '../connections/userConnections.js'

// 节点间通信消息接口
// forUserIds 为多用户列表（push 按节点分组后携带该节点上全部在线用户）；
// 接收端对列表内每个用户各自 emit。兼容在途的单值 forUserId（旧消息）。
interface NoviNodeMessage {
    fromNode: string
    forUserIds?: string[]
    forUserId?: string
    event: string
    message: string
    timestamp: number
}

// 解析后的消息内容接口
interface ParsedMessage {
    [key: string]: unknown
}

/**
 * 节点间通信管理类
 */
class NoviNodeIPC {
    /**
     * 初始化节点通信 Kafka + RabbitMQ
     */
    public init(): void {
        this.initKafka();
        this.initRabbitMQ();
        logger.info('[noviNodeIPC] 初始化完成');
    }

    /**
     * 初始化Kafka
     */
    private initKafka(): void {
        try {
            mqKafkaInit();
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '未知错误'
            logger.error(`[noviNodeIPC] 初始化 Kafka 出错: ${errorMessage}`)
        }
    }

    /**
     * 初始化RabbitMQ
     */
    private initRabbitMQ(): void {
        try {
            mqRabbitMQInit((msgFromNoviNode: string): void => {
                this.handleRabbitMQMessage(msgFromNoviNode)
            })
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '未知错误'
            logger.error(`[noviNodeIPC] 初始化 RabbitMQ 出错: ${errorMessage}`)
        }
    }

    /**
     * 处理从 RabbitMQ 收到的消息
     * @param rawMsg - 原始消息字符串
     */
    private handleRabbitMQMessage(rawMsg: string): void {
        if (!rawMsg && rawMsg !== '') {
            return
        }

        try {
            const json: NoviNodeMessage = JSON.parse(rawMsg)
            // 验证消息格式：forUserIds 与 forUserId 至少其一（兼容在途旧消息）
            const hasTarget = (Array.isArray(json?.forUserIds) && json.forUserIds.length > 0)
                || (typeof json?.forUserId === 'string' && json.forUserId.length > 0);
            if (!json?.fromNode || !json?.event || !json?.message || !hasTarget) {
                logger.warn(`[noviNodeIPC] 收到格式异常的消息: ${rawMsg}`)
                return
            }

            // 尝试解析 message 字段
            let message: ParsedMessage

            try {
                message = JSON.parse(json.message)
            } catch (parseErr) {
                logger.error(`[noviNodeIPC] message 字段不是合法 JSON: ${json.message}`)
                message = { raw: json.message } // 作为字符串封装
            }

            // 分发到上层处理：forUserIds 优先（多用户 fan-out），否则回退单值 forUserId（在途旧消息）
            if (json.forUserIds && json.forUserIds.length > 0) {
                this.msgFromNoviNode(json.fromNode, json.forUserIds, json.event, message)
            } else if (json.forUserId) {
                this.msgFromNoviNode(json.fromNode, json.forUserId, json.event, message)
            }

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '未知错误'
            logger.error(`[noviNodeIPC] 解析消息失败: ${errorMessage} | 原始消息: ${rawMsg}`)
        }
    }

    /**
     * 发送消息到目标节点
     * @param noviNode - 目标节点ID
     * @param msg - 消息对象
     * @returns void
     */
    public sendToNode(noviNode: string, msg: NoviNodeMessage | null): void {
        try {
            // 参数验证 noviNode为''也不行
            if (!noviNode) {
                logger.warn('[noviNodeIPC] sendToNode: noviNode 未指定')
                return
            }
            if (!msg) {
                logger.warn('[noviNodeIPC] sendToNode: msg 为空')
                return
            }
            const jsonStr = JSON.stringify(msg)
            rabbitMQNoviNodeChannel.sendToNoviNode(noviNode, jsonStr)
            logger.info(`[noviNodeIPC] 已发送消息到节点 ${noviNode}: ${jsonStr}`)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '未知错误'
            logger.error(`[noviNodeIPC] 发送消息失败: ${errorMessage}`)
        }
    }

    public createNewMessage(
        forUserId: string,
        event: string,
        message: object | object[]
    ): NoviNodeMessage | null {
        try {
            const messageStr = JSON.stringify(message)
            return {
                fromNode: process.env.NOVI_NODE || 'unknown',
                forUserId,
                event,
                message: messageStr,
                timestamp: Date.now(),
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '未知错误'
            logger.error(`[noviNodeIPC] createNewMessage 失败: ${errorMessage}`)
            return null
        }
    }

    /**
     * 处理来自其他节点的消息
     * @param fromNode - 来源节点ID
     * @param forUserId - 目标用户ID（单个或该节点上的用户列表）
     * @param event - 事件名称
     * @param message - 消息内容
     */
    private msgFromNoviNode(
        fromNode: string,
        forUserId: string | string[],
        event: string,
        message: ParsedMessage
    ): void {
        try {
            const ids = Array.isArray(forUserId) ? forUserId : [forUserId];
            logger.info(
                `[noviNodeIPC] 收到来自节点 ${fromNode} 的消息 | 目标用户数=${ids.length} | event=${event} | 内容=${JSON.stringify(
                    message
                )}`
            );

            // 向每个目标用户各自分发（单 socket emit）
            for (const uid of ids) {
                userConnections.eventMessageForClientByUserId(uid, event, message)
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '未知错误'
            logger.error(`[noviNodeIPC] msgFromNoviNode 处理出错: ${errorMessage}`)
        }
    }
};

// 导出单例与消息类型
export const noviNodeIPC = new NoviNodeIPC()
export default noviNodeIPC
export type { NoviNodeMessage }
