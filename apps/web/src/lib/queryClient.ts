import { QueryCache, QueryClient } from '@tanstack/react-query';
import { toastFromAnywhere } from '../components/Toasts';

/** One client for the app — and for logout, which must wipe it so the
 * next sign-in never sees the previous user's cached data. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  // A failed fetch must be loud everywhere — never a silently empty screen.
  queryCache: new QueryCache({
    onError: (err) =>
      toastFromAnywhere(
        err instanceof Error && err.message ? `Loading failed: ${err.message}` : 'Loading failed',
      ),
  }),
});
