import amqp from 'amqplib/callback_api.js'
import logger from '../logger.js'

const QUEUE_HEARTBEAT = `/novi_node/${process.env.NOVI_NODE}/heartbeat`;
const QUEUE_IPC = `/novi_node/${process.env.NOVI_NODE}/ipc`;
const RABBITMQ_URI = process.env.RABBITMQ_URI;
const RECONNECT_DELAY = 5000 // 5 秒后重试

// 连接生产者
function createHeartbeatProducer() {
    amqp.connect(RABBITMQ_URI, (err, connection) => {
        if (err) {
            logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 生产者连接失败: ${err.message}`)
            setTimeout(createHeartbeatProducer, RECONNECT_DELAY)
            return
        }

        connection.on('error', (err) => {
            logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 生产者连接错误: ${err.message}`)
        })

        connection.on('close', () => {
            logger.warn(`[RabbitMQ]${QUEUE_HEARTBEAT} 生产者连接断开，${RECONNECT_DELAY}秒后重连...`)
            setTimeout(createHeartbeatProducer, RECONNECT_DELAY)
        })

        connection.createChannel((error1, channel) => {
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
function createHeartbeatConsumer() {
    amqp.connect(RABBITMQ_URI, (err, connection) => {
        if (err) {
            logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 消费者连接失败: ${err.message}`)
            setTimeout(createHeartbeatConsumer, RECONNECT_DELAY)
            return
        }

        connection.on('error', (err) => {
            logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 消费者连接错误: ${err.message}`)
        })

        connection.on('close', () => {
            logger.warn(`[RabbitMQ]${QUEUE_HEARTBEAT} 消费者连接断开，${RECONNECT_DELAY}秒后重连...`)
            setTimeout(createHeartbeatConsumer, RECONNECT_DELAY)
        })

        connection.createChannel((error1, channel) => {
            if (error1) {
                logger.error(`[RabbitMQ]${QUEUE_HEARTBEAT} 创建消费通道失败: ${error1.message}`)
                return
            }

            channel.assertQueue(QUEUE_HEARTBEAT, { durable: false })
            channel.consume(
                QUEUE_HEARTBEAT,
                (msg) => {
                    logger.info(`[RabbitMQ]${QUEUE_HEARTBEAT} Received heartbeat: ${msg.content.toString()}`)
                },
                { noAck: true } // 自动确认
            )
        })
    })
}

// 节点之间通信的通道
let rabbitMQNoviNodeChannel = {
    producerChannel: null,
    onReceiveStrContentFromNoviNode: null,
    initProducerChannel() {
        amqp.connect(RABBITMQ_URI, (err, connection) => {
            if (err) {
                logger.error(`[RabbitMQ]${QUEUE_IPC} 生产者连接失败: ${err.message}`)
                this.producerChannel = null;
                setTimeout(() => {
                    this.initProducerChannel()
                }, RECONNECT_DELAY)
                return;
            }

            connection.on('error', (err) => {
                logger.error(`[RabbitMQ]${QUEUE_IPC} 生产者连接错误: ${err.message}`)
                this.producerChannel = null;
            })

            connection.on('close', () => {
                logger.warn(`[RabbitMQ]${QUEUE_IPC} 生产者连接断开，${RECONNECT_DELAY}秒后重连...`)
                this.producerChannel = null
                setTimeout(() => {
                    this.initProducerChannel();
                }, RECONNECT_DELAY)
            })

            connection.createChannel((error1, channel) => {
                if (error1) {
                    logger.error(`[RabbitMQ]${QUEUE_IPC} 创建生产通道失败: ${error1.message}`)
                    return
                }

                this.producerChannel = channel;
            })
        })
    },
    sendToNoviNode(noviNode, strContent) {
        if (!this.producerChannel) {
            logger.error(`!this.producerChannel`);
            return;
        }
        const targetTopic = `/novi_node/${noviNode}/ipc`;
        this.producerChannel.sendToQueue(targetTopic, Buffer.from(strContent));
    },
    initConsumerChannel() {
        amqp.connect(RABBITMQ_URI, (err, connection) => {
            if (err) {
                logger.error(`[RabbitMQ]${QUEUE_IPC} 消费者连接失败: ${err.message}`)
                setTimeout(() => {
                    this.initConsumerChannel();
                }, RECONNECT_DELAY)
                return
            }

            connection.on('error', (err) => {
                logger.error(`[RabbitMQ]${QUEUE_IPC} 消费者连接错误: ${err.message}`)
            })

            connection.on('close', () => {
                logger.warn(`[RabbitMQ]${QUEUE_IPC} 消费者连接断开，${RECONNECT_DELAY}秒后重连...`)
                setTimeout(() => {
                    this.initConsumerChannel();
                }, RECONNECT_DELAY)
            })

            connection.createChannel((error1, channel) => {
                if (error1) {
                    logger.error(`[RabbitMQ]${QUEUE_IPC} 创建消费通道失败: ${error1.message}`)
                    return
                }

                channel.assertQueue(QUEUE_IPC, { durable: false })
                channel.consume(
                    QUEUE_IPC,
                    (msg) => {
                        if (this.onReceiveStrContentFromNoviNode) {
                            this.onReceiveStrContentFromNoviNode(msg.content.toString());
                        }
                    },
                    { noAck: true } // 自动确认
                )
            })
        })
    },

    init(onReceiveStrContentFromNoviNode) {
        this.onReceiveStrContentFromNoviNode = onReceiveStrContentFromNoviNode;
        this.initProducerChannel();
        this.initConsumerChannel();
    }
};

function mqRabbitMQInit(onReceiveStrContentFromNoviNode) {
    createHeartbeatProducer();
    createHeartbeatConsumer();
    rabbitMQNoviNodeChannel.init(onReceiveStrContentFromNoviNode);
}

export { mqRabbitMQInit, rabbitMQNoviNodeChannel };
