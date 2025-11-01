import { Kafka } from 'kafkajs'
import logger from '../logger.js';

const brokers = (process.env.KAFKA_BROKERS || "").split(",").filter(value => value !== "");

const kafka = new Kafka({
    clientId: 'novi',
    brokers: brokers
});

const create_topic = async () => {
    const admin = kafka.admin();
    await admin.connect();

    const topics = await admin.listTopics();

    logger.info(`已有的Topic: ${topics.join(',')}`);

    if (!topics.includes('test-topic')) {
        logger.info("创建Topic: test-topic");
        const topicConfig = {
            topics: [
                {
                    topic: 'test-topic',//主题名
                    numPartitions: 1,//分区数
                    replicationFactor: 1//副本数
                }],
            waitForLeaders: true//等待leader分配完成
        };

        const result = await admin.createTopics(topicConfig);
        logger.info(`topic created: ${result}`);
    }

    logger.info(`创建检查Topic后，已有的Topic: ${(await admin.listTopics()).join(',')}`);

    await admin.disconnect();
};

const producer_run = async (producer) => {
    const send_result = await producer.send({
        topic: 'test-topic',
        messages: [
            { value: `heartbeat ${Date.now()}` },
        ],
    });

    logger.info(`send result: ${JSON.stringify(send_result)}`);
    if (send_result && send_result.length > 0) {
        logger.info(`消息发送成功，主题: ${send_result[0].topicName}, 分区: ${send_result[0].partition}, 偏移量: ${send_result[0].baseOffset}`);
    } else {
        logger.info('消息发送失败');
    }
};

const consumer_run = async () => {
    let consumeCounter = 0;
    const consumer = kafka.consumer({ groupId: 'test-group' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'test-topic', fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            consumeCounter++;
            logger.info(`消费消息: consumeCounter[${consumeCounter}] ${JSON.stringify({
                value: message.value.toString(),
                topic,
                partition
            })}`)
        },
    });

    logger.info("消费者已启动，等待消息...");
};

(async () => {
    await create_topic();
    await consumer_run();

    const producer = kafka.producer();
    await producer.connect();

    setInterval(() => {
        producer_run(producer);
    }, 5000);
})();

export { kafka };
