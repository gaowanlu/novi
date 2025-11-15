import amqp from 'amqplib/callback_api.js'
import logger from '../logger.js'

const QUEUE_HEARTBEAT = `/novi_node/${process.env.NOVI_NODE}/heartbeat`;
const QUEUE_IPC = `/novi_node/${process.env.NOVI_NODE}/ipc`;
const RABBITMQ_URI = process.env.RABBITMQ_URI;
const RECONNECT_DELAY = 5000 // 5 秒后重试

type OnReceiveFn = (content: string) => void

// 连接生产者
function createHeartbeatProducer(): void {
    if (!RABBITMQ_URI) {
        logger.error('[RabbitMQ] missing RABBITMQ_URI')
        setTimeout(createHeartbeatProducer, RECONNECT_DELAY)
        return
    }

    amqp.connect(RABBITMQ_URI, (err: any, connection: amqp.Connection): void => {
        if (err) {
            logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 生产者连接失败: ${err.message}`)
            setTimeout(createHeartbeatProducer, RECONNECT_DELAY)
            return
        }

        connection.on('error', (err: any): void => {
            logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 生产者连接错误: ${err.message}`)
        })

        connection.on('close', (): void => {
            logger.warn(`[RabbitMQ]${QUEUE_HEARTBEAT} 生产者连接断开，${RECONNECT_DELAY}秒后重连...`)
            setTimeout(createHeartbeatProducer, RECONNECT_DELAY)
        })

        connection.createChannel((error1: any, channel: amqp.Channel): void => {
            if (error1) {
                logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 创建生产通道失败: ${error1.message}`)
                return
            }

            channel.assertQueue(QUEUE_HEARTBEAT, { durable: false })

            setInterval(() => {
                const msg = `${Date.now()}`
                channel.sendToQueue(QUEUE_HEARTBEAT, Buffer.from(msg))
                logger.info(`[RabbitMQ]${QUEUE_HEARTBEAT} Sent heartbeat: ${msg}`)
            }, 5000)
        })
    })
}

// 连接消费者
function createHeartbeatConsumer(): void {
    if (!RABBITMQ_URI) {
        logger.error('[RabbitMQ] missing RABBITMQ_URI')
        setTimeout(createHeartbeatConsumer, RECONNECT_DELAY)
        return
    }

    amqp.connect(RABBITMQ_URI, (err: any, connection: amqp.Connection): void => {
        if (err) {
            logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 消费者连接失败: ${err.message}`)
            setTimeout(createHeartbeatConsumer, RECONNECT_DELAY)
            return
        }

        connection.on('error', (err): void => {
            logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 消费者连接错误: ${err.message}`)
        })

        connection.on('close', (): void => {
            logger.warn(`[RabbitMQ]${QUEUE_HEARTBEAT} 消费者连接断开，${RECONNECT_DELAY}秒后重连...`)
            setTimeout(createHeartbeatConsumer, RECONNECT_DELAY)
        })

        connection.createChannel((error1: any, channel: amqp.Channel): void => {
            if (error1) {
                logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 创建消费通道失败: ${error1.message}`)
                return
            }

            channel.assertQueue(QUEUE_HEARTBEAT, { durable: false })
            channel.consume(
                QUEUE_HEARTBEAT,
                (msg: amqp.Message | null): void => {
                    if (!msg) return;
                    logger.info(`[RabbitMQ]${QUEUE_HEARTBEAT} Received heartbeat: ${msg.content.toString()}`)
                },
                { noAck: true } // 自动确认
            )
        })
    })
}

interface RabbitNoviNodeChannel {
    producerChannel: amqp.Channel | null
    onReceiveStrContentFromNoviNode: OnReceiveFn | null
    initProducerChannel(): void
    initConsumerChannel(): void
    sendToNoviNode(noviNode: string, strContent: string): void
    init(onReceiveStrContentFromNoviNode: OnReceiveFn): void
}

// 节点之间通信的通道
let rabbitMQNoviNodeChannel: RabbitNoviNodeChannel = {
    producerChannel: null,
    onReceiveStrContentFromNoviNode: null,

    initProducerChannel(): void {
        if (!RABBITMQ_URI) {
            logger.error('[RabbitMQ] missing RABBITMQ_URI')
            setTimeout((): void => this.initProducerChannel(), RECONNECT_DELAY)
            return
        }

        amqp.connect(RABBITMQ_URI, (err: any, connection: amqp.Connection): void => {
            if (err) {
                logger.error(`[RabbitMQ]${QUEUE_IPC} 生产者连接失败: ${err?.message ?? 'unknown'}`)
                this.producerChannel = null
                setTimeout((): void => this.initProducerChannel(), RECONNECT_DELAY)
                return
            }

            connection.on('error', (err): void => {
                logger.error(`[RabbitMQ]${QUEUE_IPC} 生产者连接错误: ${err.message}`)
                this.producerChannel = null;
            })

            connection.on('close', (): void => {
                logger.warn(`[RabbitMQ]${QUEUE_IPC} 生产者连接断开，${RECONNECT_DELAY}秒后重连...`)
                this.producerChannel = null
                setTimeout((): void => {
                    this.initProducerChannel();
                }, RECONNECT_DELAY)
            })

            connection.createChannel((error1: any, channel: amqp.Channel): void => {
                if (error1) {
                    logger.error(`[RabbitMQ]${QUEUE_IPC} 创建生产通道失败: ${error1.message}`)
                    return
                }

                this.producerChannel = channel;
            })
        })
    },

    sendToNoviNode(noviNode, strContent): void {
        if (!this.producerChannel) {
            logger.error(`!this.producerChannel`);
            return;
        }
        const targetTopic = `/novi_node/${noviNode}/ipc`;
        this.producerChannel.sendToQueue(targetTopic, Buffer.from(strContent));
    },

    initConsumerChannel(): void {
        if (!RABBITMQ_URI) {
            logger.error('[RabbitMQ] missing RABBITMQ_URI')
            setTimeout((): void => this.initConsumerChannel(), RECONNECT_DELAY)
            return
        }

        amqp.connect(RABBITMQ_URI, (err: any, connection: amqp.Connection): void => {
            if (err || !connection) {
                logger.error(`[RabbitMQ]${QUEUE_IPC} 消费者连接失败: ${err?.message ?? 'unknown'}`)
                setTimeout((): void => this.initConsumerChannel(), RECONNECT_DELAY)
                return
            }

            connection.on('error', (err): void => {
                logger.error(`[RabbitMQ]${QUEUE_IPC} 消费者连接错误: ${err.message}`)
            })

            connection.on('close', (): void => {
                logger.warn(`[RabbitMQ]${QUEUE_IPC} 消费者连接断开，${RECONNECT_DELAY}秒后重连...`)
                setTimeout((): void => {
                    this.initConsumerChannel();
                }, RECONNECT_DELAY);
            })

            connection.createChannel((error1: any, channel: amqp.Channel) => {
                if (error1) {
                    logger.error(`[RabbitMQ]${QUEUE_IPC} 创建消费通道失败: ${error1?.message ?? 'unknown'}`)
                    return
                }

                channel.assertQueue(QUEUE_IPC, { durable: false })
                channel.consume(
                    QUEUE_IPC,
                    (msg: amqp.Message | null): void => {
                        if (!msg) return;
                        if (this.onReceiveStrContentFromNoviNode) {
                            this.onReceiveStrContentFromNoviNode(msg.content.toString());
                        }
                    },
                    { noAck: true } // 自动确认
                )
            })
        })
    },

    init(onReceiveStrContentFromNoviNode: OnReceiveFn): void {
        this.onReceiveStrContentFromNoviNode = onReceiveStrContentFromNoviNode;
        this.initProducerChannel();
        this.initConsumerChannel();
    }
};

function mqRabbitMQInit(onReceiveStrContentFromNoviNode: OnReceiveFn): void {
    createHeartbeatProducer();
    createHeartbeatConsumer();
    rabbitMQNoviNodeChannel.init(onReceiveStrContentFromNoviNode);
}

export { mqRabbitMQInit, rabbitMQNoviNodeChannel };
