import { supabase, isSupabaseConfigured } from '../supabaseClient'

const gameVisibilityFromRow = (row) => ({
  appType: row.app_type,
  visibleInSetup: row.visible_in_setup !== false,
  updatedAt: row.updated_at ?? null,
})

export async function fetchGameTypeVisibility() {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase
    .from('game_type_visibility')
    .select('app_type, visible_in_setup, updated_at')
    .order('app_type')

  if (error) {
    console.error('[db] fetchGameTypeVisibility', error)
    return null
  }

  return (data ?? []).map(gameVisibilityFromRow)
}
