import React from 'react'

interface MessagePannelProps {
    style?: React.CSSProperties,
    className?: string
}

function MessagePannel({ style, className }: MessagePannelProps) {
    return (
        <div style={style} className={className}>
            <h2>消息</h2>
        </div>
    )
}

export default MessagePannel
