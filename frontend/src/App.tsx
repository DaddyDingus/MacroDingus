import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthStatus } from "./api/auth";
import LoginScreen from "./screens/LoginScreen";
import DashboardScreen from "./screens/DashboardScreen";
import TodayScreen from "./screens/TodayScreen";
import BottomNav from "./components/BottomNav";
import { WeightUnitProvider } from "./lib/weightUnit";
import { ShortcutsProvider } from "./lib/shortcuts";
import { DashboardLayoutProvider } from "./lib/dashboardLayout";

// Dashboard and Food log are the two hot-path screens — opened many times a
// day — so they're the only ones in the main bundle. Everything else (charts,
// camera uploads, detail drill-downs) loads on demand.
const CoachScreen = lazy(() => import("./screens/CoachScreen"));
const PhotosScreen = lazy(() => import("./screens/PhotosScreen"));
const MoreScreen = lazy(() => import("./screens/MoreScreen"));
const WeightDetailScreen = lazy(() => import("./screens/WeightDetailScreen"));
const MacrosDetailScreen = lazy(() => import("./screens/MacrosDetailScreen"));
const ExpenditureDetailScreen = lazy(() => import("./screens/ExpenditureDetailScreen"));
const EnergyBalanceDetailScreen = lazy(() => import("./screens/EnergyBalanceDetailScreen"));
const GoalProgressDetailScreen = lazy(() => import("./screens/GoalProgressDetailScreen"));
const WeighInConsistencyScreen = lazy(() => import("./screens/WeighInConsistencyScreen"));
const LoggingConsistencyScreen = lazy(() => import("./screens/LoggingConsistencyScreen"));
const NutrientDetailScreen = lazy(() => import("./screens/NutrientDetailScreen"));

export default function App() {
  const status = useAuthStatus();

  if (status.isLoading) return null;
  if (!status.data?.authenticated) return <LoginScreen />;

  return (
    <WeightUnitProvider>
      <ShortcutsProvider>
        <DashboardLayoutProvider>
          <BrowserRouter>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<DashboardScreen />} />
                <Route path="/log" element={<TodayScreen />} />
                <Route path="/strategy" element={<CoachScreen />} />
                <Route path="/weight" element={<WeightDetailScreen />} />
                <Route path="/macros" element={<MacrosDetailScreen />} />
                <Route path="/expenditure" element={<ExpenditureDetailScreen />} />
                <Route path="/energy-balance" element={<EnergyBalanceDetailScreen />} />
                <Route path="/goal-progress" element={<GoalProgressDetailScreen />} />
                <Route path="/habits/weigh-ins" element={<WeighInConsistencyScreen />} />
                <Route path="/habits/logging" element={<LoggingConsistencyScreen />} />
                <Route path="/nutrition/:metric" element={<NutrientDetailScreen />} />
                <Route path="/photos" element={<PhotosScreen />} />
                <Route path="/more" element={<MoreScreen />} />
              </Routes>
            </Suspense>
            <BottomNav />
          </BrowserRouter>
        </DashboardLayoutProvider>
      </ShortcutsProvider>
    </WeightUnitProvider>
  );
}
