import { Link } from "react-router-dom";

export default function SiteFooter() {
    return (
        <footer className="border-t border-wa-100 py-6 dark:border-white/10">
            <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-6 text-xs text-wa-700 dark:text-wa-100 md:flex-row">
                <span>© {new Date().getFullYear()} novi · 隐私是基础，而非附加</span>
                <div className="flex items-center gap-4">
                    <Link to="/about" className="hover:text-foreground hover:underline underline-offset-4">关于</Link>
                    <Link to="/functional" className="hover:text-foreground hover:underline underline-offset-4">功能</Link>
                    <a
                        href="mailto:heizuboriyo@gmail.com"
                        className="hover:text-foreground hover:underline underline-offset-4"
                    >
                        联系
                    </a>
                    <a
                        href="https://github.com/gaowanlu/novi"
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-foreground hover:underline underline-offset-4"
                    >
                        GitHub
                    </a>
                </div>
            </div>
        </footer>
    );
}
