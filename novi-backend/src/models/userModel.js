import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    username: String,
    email: String,
    createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model('User', userSchema);
