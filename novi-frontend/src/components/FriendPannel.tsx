import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

interface UserInfo {
  userId: string;
  userName: string;
}

interface FriendItem {
  requester: UserInfo;
  receiver: UserInfo;
  status: string;
  createdAt: string;
  friendRequestId: string;
}

interface FriendPanelProps {
  friendList?: FriendItem[];
  user?: any;
  currentFriendId?: string;
  onSelectFriend?: (friend: UserInfo) => void;
  className?: string;
}

export default function FriendPanel({
  friendList = [],
  user,
  currentFriendId,
  onSelectFriend,
  className
}: FriendPanelProps) {
  const myUserId = user?.userId ?? '';

  return (
    <Card className={`h-full rounded-none border-r shadow-sm ${className}`}>
      <div className="p-4 border-b text-lg font-semibold">我的好友</div>

      <ScrollArea className="h-[calc(100%-3.5rem)]">
        <div className="space-y-2 p-2">
          {friendList.length === 0 && <p className="text-gray-500 text-sm">暂无好友</p>}

          {friendList.map(item => {
            const friend = myUserId === item.receiver.userId ? item.requester : item.receiver;
            const isActive = currentFriendId === friend.userId;

            return (
              <div
                key={item.friendRequestId}
                onClick={() => onSelectFriend?.(friend)}
                className={`
                  flex items-center justify-between p-3 rounded-xl cursor-pointer
                  transition-colors
                  ${isActive ? "bg-gray-200" : "hover:bg-gray-100"}
                `}
              >
                <div className="flex items-center gap-3">
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={`https://avatars.dicebear.com/api/identicon/${friend.userId}.svg`} />
                    <AvatarFallback>{friend.userName[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-gray-900">{friend.userName}</p>
                    <p className="text-xs text-gray-500">ID: {friend.userId}</p>
                  </div>
                </div>
                <Badge className="bg-gray-100 text-gray-700 text-xs">
                  {item.status === 'accepted' ? '好友' : item.status}
                </Badge>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
