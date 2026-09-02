import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

interface UserInfo {
  userId: string | null;
  userName: string;
}

interface FriendItem {
  friendRequestId: string;
  requester: UserInfo;
  receiver: UserInfo;
  status: string;
  createdAt: string;
}

interface FriendPanelProps {
  friendList?: FriendItem[];
  user?: { userId: string } | null;
  currentFriendId?: string;
  onSelectFriend?: (friend: { userId: string; userName: string }) => void;
  /** 每个好友的未读消息数，key 为好友 userId */
  unreadCounts?: Record<string, number>;
  className?: string;
}

export default function FriendPanel({
  friendList = [],
  user,
  currentFriendId,
  onSelectFriend,
  unreadCounts = {},
  className
}: FriendPanelProps) {
  const myUserId = user?.userId ?? '';

  return (
    <Card className={`h-full rounded-none border-r shadow-sm ${className}`}>
      <div className="p-4 border-b text-lg font-semibold">我的好友</div>

      <ScrollArea className="h-[calc(100%-3.5rem)]">
        <div className="space-y-2 p-2">
          {friendList.length === 0 && (
            <p className="text-gray-500 text-sm px-2 py-4 text-center">
              暂无好友，去「新朋友」页面添加吧
            </p>
          )}

          {friendList.map(item => {
            const friend = myUserId === item.receiver.userId ? item.requester : item.receiver;
            const isActive = currentFriendId === friend.userId;
            const unread = friend.userId ? (unreadCounts[friend.userId] ?? 0) : 0;

            return (
              <div
                key={item.friendRequestId}
                onClick={() => friend.userId && onSelectFriend?.({ userId: friend.userId, userName: friend.userName })}
                className={`
                  flex items-center justify-between p-3 rounded-xl cursor-pointer
                  transition-colors
                  ${isActive ? "bg-gray-200" : "hover:bg-gray-100"}
                `}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="w-10 h-10 shrink-0">
                    <AvatarFallback>{friend.userName?.[0] ?? '?'}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{friend.userName}</p>
                    <p className="text-xs text-gray-500 truncate">ID: {friend.userId}</p>
                  </div>
                </div>
                {unread > 0 ? (
                  <Badge className="bg-red-500 text-white hover:bg-red-500 text-xs shrink-0">
                    {unread > 99 ? '99+' : unread}
                  </Badge>
                ) : (
                  <Badge className="bg-gray-100 text-gray-700 text-xs shrink-0">好友</Badge>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
