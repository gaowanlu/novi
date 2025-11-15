import { useEffect, useState } from "react"
import FriendPannel from "../components/FriendPannel"
import MessagePannel from '../components/MessagePannel'
import { apiFetch } from "../api/request";
import { APIMacro } from "../api/APIMacro";
import { useAuth } from "../context/AuthContext";

function FunctionalPage() {
    const [friendList, setFriendList] = useState([]);
    const { user } = useAuth();

    const refreshFriendList = async () => {
        const res = await apiFetch(APIMacro.GETFRIEND, {
            method: 'GET'
        });
        if (!res.ok) {
            return;
        }
        const body = await res.json();

        setFriendList(body);

        // console.log(body);
    };

    useEffect(() => {
        refreshFriendList();
        return () => { };
    }, []);

    return (
        <>
            <h1>FunctionalPage</h1>
            <div style={{ 'display': 'flex', 'justifyContent': 'center' }}>
                <FriendPannel style={{ 'width': '50%' }} friendList={friendList} user={user} />
                <MessagePannel style={{ 'width': '50%' }} />
            </div>
        </>
    )
}

export default FunctionalPage
