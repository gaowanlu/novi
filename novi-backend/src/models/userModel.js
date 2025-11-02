import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    userName: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    passwordSalt: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

// 创建唯一索引（防止重复）
userSchema.index({ userName: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });

const User = mongoose.model('user', userSchema);

export default User;
