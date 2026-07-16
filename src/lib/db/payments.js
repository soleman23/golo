import { supabase, isSupabaseConfigured } from '../supabaseClient'

/**
 * Payment requests (Phase 5). Settlements are saved server-side as
 * payment_requests with a frozen calculation snapshot; the two-step lifecycle
 * (payer marks sent → recipient confirms) is role-enforced in the RPCs
 * (migration 0026). Clients read requests for their round (RLS: members) and
 * mutate only through the RPCs — no forging state or acting for the other party.
 */

const SELECT =
  'id, round_id, payer_user_id, recipient_user_id, payer_slot_id, recipient_slot_id, ' +
  'amount, currency, status, payment_method, external_link, requested_at, ' +
  'payer_marked_sent_at, recipient_confirmed_at, disputed_at, cancelled_at'

/** Map engine settlements ([{ from, to, amount }] by slot id) to the RPC shape. */
export function settlementsPayload(settlements) {
  return (settlements ?? [])
    .filter((s) => s && s.from && s.to && Number(s.amount) > 0)
    .map((s) => ({ from: s.from, to: s.to, amount: Number(s.amount) }))
}

/** Create requests from LOCKED settlements. Returns { data: countCreated }. */
export async function createPaymentRequests(roundId, settlements, snapshot) {
  if (!isSupabaseConfigured || !roundId) return { data: 0, error: null }
  const { data, error } = await supabase.rpc('create_payment_requests', {
    p_round_id: roundId,
    p_settlements: settlementsPayload(settlements),
    p_snapshot: snapshot ?? {},
  })
  if (error) console.error('[db] createPaymentRequests', error)
  return { data, error }
}

async function rpcVoid(fn, id) {
  if (!isSupabaseConfigured || !id) return { error: 'not configured' }
  const { error } = await supabase.rpc(fn, { p_payment_id: id })
  if (error) console.error(`[db] ${fn}`, error)
  return { error }
}

export const markPaymentSent = (id) => rpcVoid('mark_payment_sent', id)
export const confirmPaymentReceived = (id) => rpcVoid('confirm_payment_received', id)
export const disputePayment = (id) => rpcVoid('dispute_payment', id)
export const markPaymentViewed = (id) => rpcVoid('mark_payment_viewed', id)
export const cancelPayment = (id) => rpcVoid('cancel_payment', id)

export async function fetchPaymentRequests(roundId) {
  if (!isSupabaseConfigured || !roundId) return []
  const { data, error } = await supabase
    .from('payment_requests')
    .select(SELECT)
    .eq('round_id', roundId)
  if (error) {
    console.error('[db] fetchPaymentRequests', error)
    return []
  }
  return data ?? []
}

export function subscribeToPaymentRequests(roundId, onChange) {
  if (!isSupabaseConfigured || !roundId) return () => {}
  const channel = supabase
    .channel(`payments-${roundId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'payment_requests', filter: `round_id=eq.${roundId}` },
      () => onChange(),
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}
