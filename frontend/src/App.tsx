import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthStatus } from "./api/auth";
import LoginScreen from "./screens/LoginScreen";
import TodayScreen from "./screens/TodayScreen";
import TrendsScreen from "./screens/TrendsScreen";
import CoachScreen from "./screens/CoachScreen";
import PhotosScreen from "./screens/PhotosScreen";
import MoreScreen from "./screens/MoreScreen";
import BottomNav from "./components/BottomNav";

export default function App() {
  const status = useAuthStatus();

  if (status.isLoading) return null;
  if (!status.data?.authenticated) return <LoginScreen />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/trends" element={<TrendsScreen />} />
        <Route path="/coach" element={<CoachScreen />} />
        <Route path="/photos" element={<PhotosScreen />} />
        <Route path="/more" element={<MoreScreen />} />
      </Routes>
      <BottomNav />
    </BrowserRouter>
  );
}
