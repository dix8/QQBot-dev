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

interface HourlyBucket {
  hour: string
  received: number
  sent: number
}

interface RankedEntry {
  id: number
  count: number
}

interface StatsInfo {
  hourly: HourlyBucket[]
  topGroups: RankedEntry[]
  topUsers: RankedEntry[]
  totalReceived: number
  totalSent: number
}

const health = ref<HealthInfo | null>(null)
const stats = ref<StatsInfo | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const error = ref('')

let timer: ReturnType<typeof setInterval>

const POLL_INTERVAL_MS = 5000

async function fetchData() {
  try {
    const [h, s] = await Promise.all([
      apiFetch<HealthInfo>('/api/health'),
      apiFetch<StatsInfo>('/api/stats'),
    ])
    health.value = h
    stats.value = s
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

/** Maximum value in hourly chart for scaling bars */
const hourlyMax = computed(() => {
  if (!stats.value) return 1
  return Math.max(1, ...stats.value.hourly.map(b => Math.max(b.received, b.sent)))
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

        <!-- Messages -->
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">消息统计</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold">{{ (stats?.totalReceived ?? 0).toLocaleString() }}</span>
              <span class="text-sm text-muted-foreground">收</span>
              <span class="text-lg font-semibold text-muted-foreground">/</span>
              <span class="text-2xl font-bold">{{ (stats?.totalSent ?? health.totalMessagesSent ?? 0).toLocaleString() }}</span>
              <span class="text-sm text-muted-foreground">发</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">自启动以来</p>
          </CardContent>
        </Card>
      </div>

      <!-- Hourly message trend chart -->
      <Card v-if="stats && stats.hourly.length > 0">
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">消息趋势（近 24 小时）</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex items-end gap-[2px] h-32">
            <div v-for="(bucket, i) in stats.hourly" :key="i"
              class="flex-1 flex flex-col items-center gap-[1px] min-w-0 group relative">
              <!-- Received bar -->
              <div class="w-full rounded-t-sm bg-blue-500/80 transition-all duration-300"
                :style="{ height: (bucket.received / hourlyMax * 100) + '%', minHeight: bucket.received > 0 ? '2px' : '0' }" />
              <!-- Sent bar -->
              <div class="w-full rounded-b-sm bg-emerald-500/80 transition-all duration-300"
                :style="{ height: (bucket.sent / hourlyMax * 100) + '%', minHeight: bucket.sent > 0 ? '2px' : '0' }" />
              <!-- Tooltip -->
              <div class="absolute bottom-full mb-1 hidden group-hover:block bg-popover text-popover-foreground text-xs rounded px-2 py-1 shadow-md whitespace-nowrap z-10">
                {{ bucket.hour }}<br>收: {{ bucket.received }} / 发: {{ bucket.sent }}
              </div>
            </div>
          </div>
          <div class="flex justify-between mt-1 text-[10px] text-muted-foreground">
            <span>{{ stats.hourly[0]?.hour }}</span>
            <span>{{ stats.hourly[Math.floor(stats.hourly.length / 2)]?.hour }}</span>
            <span>{{ stats.hourly[stats.hourly.length - 1]?.hour }}</span>
          </div>
          <div class="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span class="flex items-center gap-1">
              <span class="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500/80" /> 接收
            </span>
            <span class="flex items-center gap-1">
              <span class="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/80" /> 发送
            </span>
          </div>
        </CardContent>
      </Card>

      <!-- Top groups & users -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4" v-if="stats">
        <!-- Top Groups -->
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">活跃群组 Top5</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="stats.topGroups.length === 0" class="text-sm text-muted-foreground">暂无数据</div>
            <div v-else class="space-y-2">
              <div v-for="(g, i) in stats.topGroups.slice(0, 5)" :key="g.id" class="flex items-center gap-2">
                <span class="w-5 text-xs font-mono text-muted-foreground text-right">{{ i + 1 }}.</span>
                <div class="flex-1 min-w-0">
                  <div class="flex justify-between text-sm">
                    <span class="font-mono truncate">{{ g.id }}</span>
                    <span class="text-muted-foreground ml-2 shrink-0">{{ g.count }} 条</span>
                  </div>
                  <div class="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                    <div class="h-full bg-blue-500/70 rounded-full transition-all duration-300"
                      :style="{ width: (g.count / (stats.topGroups[0]?.count || 1) * 100) + '%' }" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Top Users -->
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">活跃用户 Top5</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="stats.topUsers.length === 0" class="text-sm text-muted-foreground">暂无数据</div>
            <div v-else class="space-y-2">
              <div v-for="(u, i) in stats.topUsers.slice(0, 5)" :key="u.id" class="flex items-center gap-2">
                <span class="w-5 text-xs font-mono text-muted-foreground text-right">{{ i + 1 }}.</span>
                <div class="flex-1 min-w-0">
                  <div class="flex justify-between text-sm">
                    <span class="font-mono truncate">{{ u.id }}</span>
                    <span class="text-muted-foreground ml-2 shrink-0">{{ u.count }} 条</span>
                  </div>
                  <div class="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                    <div class="h-full bg-emerald-500/70 rounded-full transition-all duration-300"
                      :style="{ width: (u.count / (stats.topUsers[0]?.count || 1) * 100) + '%' }" />
                  </div>
                </div>
              </div>
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
