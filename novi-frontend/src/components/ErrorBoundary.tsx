import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        console.error('ErrorBoundary caught:', error, info.componentStack);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex min-h-screen items-center justify-center bg-background">
                    <div className="max-w-md space-y-4 text-center">
                        <h1 className="text-2xl font-semibold">出了点问题</h1>
                        <p className="text-sm text-muted-foreground">
                            页面渲染时发生错误，请刷新重试。
                        </p>
                        {this.state.error && (
                            <p className="text-xs text-muted-foreground/60 break-all">
                                {this.state.error.message}
                            </p>
                        )}
                        <button
                            onClick={this.handleReset}
                            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                        >
                            重新加载
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
