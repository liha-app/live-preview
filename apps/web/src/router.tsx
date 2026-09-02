import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { HomeRoute } from './routes/HomeRoute.js';
import { MeRoute } from './routes/MeRoute.js';
import { PreviewRoute, PreviewRouteFromPath } from './routes/PreviewRoute.js';
import { ownPreviewSlug } from './lib/ownPreview.js';

const rootRoute = createRootRoute({ component: Outlet });

/**
 * On a host dedicated to one preview, every path is that preview's review
 * screen — the preview owns the whole origin, so what it does with paths under
 * it is its own business. Everywhere else, `/` is the landing page.
 */
function Index() {
  const slug = ownPreviewSlug();
  return slug ? <PreviewRoute slug={slug} /> : <HomeRoute />;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Index,
});

const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug',
  component: PreviewRouteFromPath,
});

/**
 * A dedicated host serves the app for any path, so the router has to render
 * something for all of them rather than a not-found.
 */
/**
 * Everything this browser is involved in. Served from any of this deployment's
 * origins, since the account it reads lives in a cookie on the API rather than
 * in one origin's storage.
 */
const meRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/me',
  component: MeRoute,
});

const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  component: Index,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, previewRoute, meRoute, catchAllRoute]),
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
