import { mqKafkaInit } from './mqKafka.js'
import { mqRabbitMQInit, rabbitMQNoviNodeChannel } from './mqRabbitmq.js'
import logger from '../logger.js'

const noviNodeIPC = {
    /**
     * 初始化节点间通信（Kafka + RabbitMQ）
     */
    init() {
        try {
            mqKafkaInit();
        } catch (err) {
            logger.error(`[noviNodeIPC] 初始化 Kafka 出错: ${err.message}`);
        }

        try {
            mqRabbitMQInit((msgFromNoviNode) => {
                this.handleRabbitMQMessage(msgFromNoviNode);
            });
        } catch (err) {
            logger.error(`[noviNodeIPC] 初始化 RabbitMQ 出错: ${err.message}`);
        }

        logger.info(`[noviNodeIPC] 初始化完成`);

        // setInterval(() => {
        //     this.sendToNode(1, this.createNewMessage("test", {
        //         data: 'test data'
        //     }));
        // }, 1000);
    },

    /**
     * 私有：处理从 RabbitMQ 收到的消息
     */
    handleRabbitMQMessage(rawMsg) {
        if (!rawMsg) return;

        try {
            const json = JSON.parse(rawMsg);
            if (!json?.fromNode || !json?.event || !json?.message) {
                logger.warn(`[noviNodeIPC] 收到格式异常的消息: ${rawMsg}`);
                return;
            }

            let message;
            try {
                message = JSON.parse(json.message);
            } catch (parseErr) {
                logger.warn(`[noviNodeIPC] message 字段不是合法 JSON: ${json.message}`);
                message = json.message; // 尝试当作字符串使用
            }

            // 分发到上层处理
            this.msgFromNoviNode(json.fromNode, json.event, message);
        } catch (err) {
            logger.error(`[noviNodeIPC] 解析消息失败: ${err.message} | 原始消息: ${rawMsg}`);
        }
    },

    /**
     * 发送消息到目标节点
     */
    sendToNode(noviNode, msg) {
        try {
            if (!noviNode) {
                logger.warn(`[noviNodeIPC] sendToNode: noviNode 未指定`);
                return;
            }
            if (!msg) {
                logger.warn(`[noviNodeIPC] sendToNode: msg 为空`);
                return;
            }

            const jsonStr = JSON.stringify(msg);
            rabbitMQNoviNodeChannel.sendToNoviNode(noviNode, jsonStr);
            logger.info(`[noviNodeIPC] 已发送消息到节点 ${noviNode}: ${jsonStr}`);
        } catch (err) {
            logger.error(`[noviNodeIPC] 发送消息失败: ${err.message}`);
        }
    },

    /**
     * 创建标准消息格式
     */
    createNewMessage(event, message) {
        try {
            const messageStr = JSON.stringify(message);
            return {
                fromNode: process.env.NOVI_NODE || 'unknown',
                event,
                message: messageStr,
                timestamp: Date.now(),
            };
        } catch (err) {
            logger.error(`[noviNodeIPC] createNewMessage 失败: ${err.message}`);
            return null;
        }
    },

    /**
     * 收到其他节点发来的消息
     */
    msgFromNoviNode(fromNode, event, message) {
        try {
            logger.info(`[noviNodeIPC] 收到来自节点 ${fromNode} 的消息 | event=${event} | 内容=${JSON.stringify(message)}`);
            // 这里可以根据 event 分发到不同的处理逻辑
        } catch (err) {
            logger.error(`[noviNodeIPC] msgFromNoviNode 处理出错: ${err.message}`);
        }
    },
};

export { noviNodeIPC };
