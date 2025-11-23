import { useEffect, useState } from "react";
import FriendPanel from "@/components/FriendPannel";
import MessagePanel from "@/components/MessagePannel";
import { apiFetch } from "@/api/request";
import { APIMacro } from "@/api/APIMacro";
import { useAuth } from "@/context/AuthContext";

function FunctionalPage() {
    const [friendList, setFriendList] = useState([]);
    const [currentFriend, setCurrentFriend] = useState(null);

    const { user } = useAuth();

    const refreshFriendList = async () => {
        const res = await apiFetch(APIMacro.GETFRIEND, {
            method: "GET",
        });

        if (!res.ok) return;

        const body = await res.json();
        setFriendList(body);

        // 默认选中第一个好友
        if (body.length > 0) {
            setCurrentFriend(body[0]);
        }
    };

    useEffect(() => {
        refreshFriendList();
    }, []);

    return (
        <div className="w-screen h-screen grid grid-cols-[280px_1fr] bg-gray-100">
            <FriendPanel
                friendList={friendList}
            // currentFriend={currentFriend}
            // onSelectFriend={setCurrentFriend}
            />

            <MessagePanel
                friend={currentFriend}
                user={user}
            />
        </div>
    );
}

export default FunctionalPage;
