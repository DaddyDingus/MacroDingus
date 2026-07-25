import { useAuthStatus } from "./api/auth";
import LoginScreen from "./screens/LoginScreen";
import TodayScreen from "./screens/TodayScreen";

export default function App() {
  const status = useAuthStatus();

  if (status.isLoading) return null;
  if (!status.data?.authenticated) return <LoginScreen />;
  return <TodayScreen />;
}
