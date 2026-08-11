import { Routes, Route } from "react-router-dom";
import "./App.css";
import Dashboard from "./screens/Dashboard";
import PreviewPage from "./screens/Preview";
import RoomPage from "./screens/Room";
import Settings from "./screens/Settings";
import Login from "./screens/Login";
import RequireAuth from "./components/RequireAuth";

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />

        {/*
          Preview and Room are intentionally NOT gated. Someone following a
          shared invite link can join as a guest; they are asked for a display
          name on the pre-join screen and prompted to sign up after the call.
        */}
        <Route path="/preview/:roomCode" element={<PreviewPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />

        <Route
          path="/settings"
          element={
            <RequireAuth>
              <Settings />
            </RequireAuth>
          }
        />
      </Routes>
    </div>
  );
}

export default App;
