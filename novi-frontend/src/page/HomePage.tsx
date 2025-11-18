import { Link } from "react-router-dom";

function HomePage() {
    return (
        <>
            <h1 className="text-3xl font-bold underline">novi, no way.</h1>
            <p>Each friendship, a unique encryption pair the platform can never see.</p>

            <ul>
                <li><Link to="/">首页</Link></li>
                <li><Link to="/signin">登录</Link></li>
                <li><Link to="/functional">功能</Link></li>
                <li><Link to="/signup">注册</Link></li>
                <li><Link to="/logout">退出登录</Link></li>
                <li><Link to="/user/info">个人信息</Link></li>
                <li><Link to="/new/friend">添加好友</Link></li>
                <li><Link to="/about">关于我们</Link></li>
            </ul>
        </>
    );
}

export default HomePage;