import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthStatus } from "./api/auth";
import LoginScreen from "./screens/LoginScreen";
import TodayScreen from "./screens/TodayScreen";
import BottomNav from "./components/BottomNav";
import { WeightUnitProvider } from "./lib/weightUnit";

// Log is the hot path — opened every day, many times a day — so it's the only
// screen in the main bundle. Everything else (charts, camera uploads) is
// visited far less often and loads on demand instead of costing every visit.
const TrendsScreen = lazy(() => import("./screens/TrendsScreen"));
const CoachScreen = lazy(() => import("./screens/CoachScreen"));
const PhotosScreen = lazy(() => import("./screens/PhotosScreen"));
const MoreScreen = lazy(() => import("./screens/MoreScreen"));

export default function App() {
  const status = useAuthStatus();

  if (status.isLoading) return null;
  if (!status.data?.authenticated) return <LoginScreen />;

  return (
    <WeightUnitProvider>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<TodayScreen />} />
            <Route path="/trends" element={<TrendsScreen />} />
            <Route path="/coach" element={<CoachScreen />} />
            <Route path="/photos" element={<PhotosScreen />} />
            <Route path="/more" element={<MoreScreen />} />
          </Routes>
        </Suspense>
        <BottomNav />
      </BrowserRouter>
    </WeightUnitProvider>
  );
}
