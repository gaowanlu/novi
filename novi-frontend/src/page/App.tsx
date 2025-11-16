import { Routes, Route } from 'react-router-dom'
import AboutPage from './AboutPage'
import HomePage from './HomePage'
import SigninPage from './SigninPage'
import SignupPage from './SignupPage'
import LogoutPage from './LogoutPage'
import FunctionalPage from './FunctionalPage'
import UserInfoPage from './UserInfoPage'
import NewFriendPage from './NewFriendPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/signin" element={<SigninPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/logout" element={<LogoutPage />} />
      <Route path="/functional" element={<FunctionalPage />} />
      <Route path="/user/info" element={<UserInfoPage />} />
      <Route path="/new/friend" element={<NewFriendPage />} />
      <Route path="/about" element={<AboutPage />} />
    </Routes>
  )
}

export default App
