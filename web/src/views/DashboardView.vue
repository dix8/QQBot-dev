<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiFetch, isAuthError } from '@/api/client'
import { RefreshCw } from 'lucide-vue-next'

interface HealthInfo {
  status: string
  timestamp: string
  connections: number
  totalMessagesSent: number
  bots: {
    total: number
    enabled: number
    connected: number
  }
  memory: {
    total: number
    used: number
    free: number
    percent: number
  }
  cpu: {
    cores: number
    usage: number
    model: string
  }
}

const health = ref<HealthInfo | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const error = ref('')

let timer: ReturnType<typeof setInterval>

const POLL_INTERVAL_MS = 5000

async function fetchData() {
  try {
    health.value = await apiFetch<HealthInfo>('/api/health')
    error.value = ''
  } catch (e) {
    if (isAuthError(e)) {
      clearInterval(timer)
      return
    }
    error.value = e instanceof Error ? e.message : '请求失败'
  } finally {
    loading.value = false
  }
}

async function handleRefresh() {
  refreshing.value = true
  try {
    await fetchData()
  } finally {
    refreshing.value = false
  }
}

onMounted(() => {
  fetchData()
  timer = setInterval(fetchData, POLL_INTERVAL_MS)
})

onUnmounted(() => {
  clearInterval(timer)
})

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return gb.toFixed(1) + ' GB'
  const mb = bytes / (1024 * 1024)
  return mb.toFixed(0) + ' MB'
}

function formatTime(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString()
}

const memoryBarColor = computed(() => {
  if (!health.value) return 'bg-green-500'
  const p = health.value.memory.percent
  if (p >= 90) return 'bg-red-500'
  if (p >= 70) return 'bg-yellow-500'
  return 'bg-green-500'
})

const cpuBarColor = computed(() => {
  if (!health.value) return 'bg-green-500'
  const u = health.value.cpu.usage
  if (u >= 90) return 'bg-red-500'
  if (u >= 70) return 'bg-yellow-500'
  return 'bg-green-500'
})
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">仪表盘</h1>
        <p class="text-sm text-muted-foreground mt-1">系统状态概览</p>
      </div>
      <Button variant="outline" size="sm" @click="handleRefresh" :disabled="refreshing">
        <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': refreshing }" />
      </Button>
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">加载中...</div>
    <div v-else-if="error" class="text-sm text-red-500">{{ error }}</div>

    <template v-else-if="health">
      <!-- Top row: status + bots + messages -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- Service Status -->
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">服务状态</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full"
                :class="health.status === 'ok' ? 'bg-green-500' : 'bg-red-500'" />
              <span class="text-2xl font-bold">{{ health.status === 'ok' ? '正常' : health.status }}</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">更新于 {{ formatTime(health.timestamp) }}</p>
          </CardContent>
        </Card>

        <!-- Bot statistics -->
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">机器人</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-end justify-between">
              <div class="flex items-baseline gap-2">
                <span class="text-2xl font-bold">{{ health.bots.total }}</span>
                <span class="text-sm text-muted-foreground">个机器人</span>
              </div>
              <div class="flex gap-4 text-sm">
                <span>启用 <strong>{{ health.bots.enabled }}</strong></span>
                <span>已连接 <strong class="text-green-600 dark:text-green-400">{{ health.bots.connected }}</strong></span>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Messages sent -->
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">消息发送</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold">{{ health.totalMessagesSent.toLocaleString() }}</span>
              <span class="text-sm text-muted-foreground">条消息已发送</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Memory usage -->
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">内存占用</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-2xl font-bold">{{ health.memory.percent }}%</span>
            <span class="text-sm text-muted-foreground">
              {{ formatBytes(health.memory.used) }} / {{ formatBytes(health.memory.total) }}
            </span>
          </div>
          <div class="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500"
              :class="memoryBarColor"
              :style="{ width: health.memory.percent + '%' }" />
          </div>
          <p class="text-xs text-muted-foreground mt-2">
            可用 {{ formatBytes(health.memory.free) }}
          </p>
        </CardContent>
      </Card>

      <!-- CPU load -->
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">CPU 负载</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-2xl font-bold">{{ health.cpu.usage }}%</span>
            <span class="text-sm text-muted-foreground">{{ health.cpu.cores }} 核心</span>
          </div>
          <div class="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500"
              :class="cpuBarColor"
              :style="{ width: health.cpu.usage + '%' }" />
          </div>
          <p class="text-xs text-muted-foreground mt-2">{{ health.cpu.model }}</p>
        </CardContent>
      </Card>

    </template>
  </div>
</template>
