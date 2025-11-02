import mongoose from 'mongoose'
import logger from '../logger.js';
import { onMongoConnected } from '../models/mongoModel.js';

export const connectMongo = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        logger.info("MongoDB connected");
        onMongoConnected();

    } catch (err) {
        logger.error("MongoDB connect failed");
    }
};
