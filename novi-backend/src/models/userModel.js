import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    user_name: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now },
});

// 创建唯一索引（防止重复）
userSchema.index({ user_name: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });

const User = mongoose.model('user', userSchema);

export default User;
