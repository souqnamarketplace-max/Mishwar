import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const queryClientInstance = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't refetch on every window focus — reduces server load
      refetchOnWindowFocus: false,
      // Don't refetch on reconnect (realtime handles this)
      refetchOnReconnect: false,
      // Keep data fresh for 60 seconds — reduces redundant fetches
      staleTime: 60_000,
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60_000,
      // Retry once on failure, with exponential backoff
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
    mutations: {
      // Show toast on mutation errors that aren't handled locally
      onError: (error) => {
        const msg = error?.message || 'حدث خطأ، يرجى المحاولة مجدداً';
        if (!msg.includes('Not authenticated') && !msg.includes('AbortError')) {
          toast.error(msg.slice(0, 120));
        }
      },
    },
  },
});
