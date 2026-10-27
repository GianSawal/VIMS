import { useQuery } from '@tanstack/react-query'
import { api } from './api'

// Unread badge count, refreshed every 60s. Shared by the sidebar and the Notifications page.
export function useUnreadCount() {
  return useQuery({
    queryKey: ['/notifications/unread-count/'],
    queryFn: () => api.get('/notifications/unread-count/').then((r) => r.data.count),
    refetchInterval: 60000,
  })
}
