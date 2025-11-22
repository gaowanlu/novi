import React from 'react'

interface UserInfo {
  userId: string
  userName: string
}

interface FriendItem {
  requester: UserInfo
  receiver: UserInfo
  status: string
  createdAt: string
  friendRequestId: string
}

interface FriendPannelProps {
  style?: React.CSSProperties,
  friendList?: FriendItem[],
  user?: any,
  className?: string
}

function FriendPannel({ style, friendList = [], user, className }: FriendPannelProps) {
  const myUserId = user ? user.userId : '';

  return (
    <div style={{ ...style, padding: '10px' }} className={className}>
      <p>我的好友</p>
      {friendList.length === 0 ? (
        <p>暂无好友</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {friendList.map((item) => {
            // 这里决定当前用户是谁，你可以根据需要判断
            const friend = myUserId === item.receiver.userId ? item.requester : item.receiver;

            return (
              <li
                key={item.friendRequestId}
                style={{
                  padding: '8px 10px',
                  marginBottom: '6px',
                  backgroundColor: '#f9f9f9',
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer'
                }}
              >
                <div>
                  <p>UserID: {friend.userId}</p>
                  <p>UserName: {friend.userName}</p>
                  <small style={{ color: '#666' }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </small>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default FriendPannel
