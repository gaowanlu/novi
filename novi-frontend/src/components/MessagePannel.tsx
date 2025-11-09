import React from 'react'

interface MessagePannelProps {
    style?: React.CSSProperties
}

function MessagePannel({ style }: MessagePannelProps) {
    return (
        <div style={style}>
            <h2>MessagePannel</h2>
        </div>
    )
}

export default MessagePannel
