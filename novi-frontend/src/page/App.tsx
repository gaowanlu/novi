import { Routes, Route } from 'react-router-dom'
import About from './About'

function App() {
  return (
    <Routes>
      <Route path="/" element={<About />} />
      <Route path="/about" element={<About />} />
    </Routes>
  )
}

export default App
