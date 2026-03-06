import { ref, readonly } from 'vue'
import { getToken } from '@/api/client'

type EventCallback = (data: unknown) => void

const connected = ref(false)
const reconnecting = ref(false)

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000
const MAX_RECONNECT_DELAY = 30_000
const listeners = new Map<string, Set<EventCallback>>()
let started = false

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const token = getToken()
  return `${proto}://${location.host}/ws/admin?token=${encodeURIComponent(token ?? '')}`
}

function handleMessage(ev: MessageEvent) {
  try {
    const { event, data } = JSON.parse(ev.data)
    const cbs = listeners.get(event)
    if (cbs) {
      for (const cb of cbs) cb(data)
    }
  } catch (e) { console.warn('[AdminWs] malformed message:', e) }
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  const token = getToken()
  if (!token) return

  try {
    socket = new WebSocket(getWsUrl())
  } catch (e) {
    console.warn('[AdminWs] connect failed:', e)
    scheduleReconnect()
    return
  }

  socket.onopen = () => {
    connected.value = true
    reconnecting.value = false
    reconnectDelay = 1000
  }

  socket.onmessage = handleMessage

  socket.onclose = (ev) => {
    connected.value = false
    socket = null
    if (ev.code !== 4003) {
      scheduleReconnect()
    }
  }

  socket.onerror = () => {
    // onclose will fire next
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnecting.value = true
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
    connect()
  }, reconnectDelay)
}

export function startAdminWs() {
  if (started) return
  started = true
  connect()
}

export function stopAdminWs() {
  started = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (socket) {
    socket.close(1000)
    socket = null
  }
  connected.value = false
  reconnecting.value = false
}

export function onAdminWsEvent(event: string, callback: EventCallback) {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(callback)
}

export function offAdminWsEvent(event: string, callback: EventCallback) {
  const set = listeners.get(event)
  if (set) {
    set.delete(callback)
    if (set.size === 0) listeners.delete(event)
  }
}

export function useAdminWs() {
  return {
    connected: readonly(connected),
    reconnecting: readonly(reconnecting),
    on: onAdminWsEvent,
    off: offAdminWsEvent,
    start: startAdminWs,
    stop: stopAdminWs,
  }
}
