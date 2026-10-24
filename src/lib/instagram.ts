import { create } from 'zustand'
import { useEffect } from 'react'
import type { InstagramState } from '../shared/instagram'
import { request } from './api'
import { useAuth } from '../stores/auth'

const useInstagramStore = create<{ data: InstagramState | null; error: string; refresh: () => Promise<void> }>((set) => ({
  data: null, error: '', refresh: async () => {
    const identity = useAuth.getState().workspaceKey
    if (!useAuth.getState().user) { set({ data: null, error: '' }); return }
    try { const data = await request<InstagramState>('/instagram'); if (identity === useAuth.getState().workspaceKey) set({ data, error: '' }) }
    catch (error) { if (identity === useAuth.getState().workspaceKey) set({ error: error instanceof Error ? error.message : 'Instagram 连接状态暂不可用' }) }
  },
}))
export function useInstagramState() {
  const state = useInstagramStore()
  const identity = useAuth((s) => s.workspaceKey), user = useAuth((s) => s.user)
  useEffect(() => { void state.refresh(); if (!user) return; const timer = setInterval(() => { void state.refresh() }, 5000); return () => clearInterval(timer) }, [state.refresh, identity, user])
  return state
}
useAuth.subscribe((state, previous) => { if (state.workspaceKey !== previous.workspaceKey) useInstagramStore.setState({ data: null, error: '' }) })
export function zonedSchedule(input: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input)
  if (!match) throw new Error('请选择完整的发布时间。')
  const wanted = Date.UTC(...([+match[1], +match[2] - 1, +match[3], +match[4], +match[5]] as [number, number, number, number, number]))
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const at = (time: number) => { const parts = Object.fromEntries(format.formatToParts(time).map((p) => [p.type, p.value])); return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) }
  let time = wanted
  for (let i = 0; i < 3; i++) time += wanted - at(time)
  if (at(time) !== wanted) throw new Error('这个时间处于夏令时切换区间，请选择其他时间。')
  if ([time - 3600000, time + 3600000].some((candidate) => at(candidate) === wanted)) throw new Error('这个时间在夏令时切换时重复，请选择其他时间。')
  return new Date(time).toISOString()
}
