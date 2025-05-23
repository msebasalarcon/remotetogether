import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import PersonA from "./pages/RoomA";
import PersonB from "./pages/RoomB";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room" element={<PersonA />} />           {/* Room Creator */}
        <Route path="/room/:roomId" element={<PersonB />} />   {/* Room Joiner */}
      </Routes>
    </Router>
  );
}

export default App;
