import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { HomeRoute } from './routes/HomeRoute.js';
import { PreviewRoute } from './routes/PreviewRoute.js';

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});

const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug',
  component: PreviewRoute,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, previewRoute]),
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
