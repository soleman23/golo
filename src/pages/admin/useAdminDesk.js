import { useOutletContext } from 'react-router-dom'

const fallback = {
  refreshKey: 0,
  refresh: () => {},
  stats: null,
}

export default function useAdminDesk() {
  return useOutletContext() ?? fallback
}
