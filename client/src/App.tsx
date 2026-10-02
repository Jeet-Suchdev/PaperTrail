import { createBrowserRouter } from 'react-router';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RootRedirect } from './components/RootRedirect';
import { DashboardPage } from './pages/DashboardPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';

export const router = createBrowserRouter([
  { path: '/', Component: RootRedirect },
  { path: '/login', Component: LoginPage },
  { path: '/register', Component: RegisterPage },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
  // Slice 0's health page, moved off "/" — still useful for monitoring.
  { path: '/health', Component: HomePage },
  { path: '*', Component: NotFoundPage },
]);
