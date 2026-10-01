import { createBrowserRouter } from 'react-router';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

export const router = createBrowserRouter([
  { path: '/', Component: HomePage },
  { path: '*', Component: NotFoundPage },
]);
