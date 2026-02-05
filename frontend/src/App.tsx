import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ProjectListPage } from "./pages/ProjectListPage";
import { EditorPage } from "./pages/EditorPage";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<EditorPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected routes (require login) */}
        <Route element={<ProtectedRoute />}>
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/editor/:projectId" element={<EditorPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
