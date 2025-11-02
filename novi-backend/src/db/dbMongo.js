import mongoose from 'mongoose'
import logger from '../logger.js';
import { User } from '../models/mongoModel.js';

export const connectMongo = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        logger.info("MongoDB connected");
        User.syncIndexes();

    } catch (err) {
        logger.error("MongoDB connect failed");
    }
};
