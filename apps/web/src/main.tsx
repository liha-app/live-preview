import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { I18nProvider } from './i18n/index.js';
import { initTheme } from './lib/theme.js';
import './styles.css';

// Before the first paint: an explicitly-dark user should never see a white flash.
initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Review state changes from three directions at once — the reviewer, the
      // CLI and an agent — so keep it fresh but not chatty.
      staleTime: 2_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
