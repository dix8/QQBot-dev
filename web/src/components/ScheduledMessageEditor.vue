<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { Plus, Trash2, Pencil, Clock } from 'lucide-vue-next'

interface SingleTask {
  type?: undefined
  hour: number
  minute: number
  group_ids: number[]
  message: string
}

interface CronTask {
  type: 'cron'
  cron: string
  group_ids: number[]
  message: string
}

type ScheduledTask = SingleTask | CronTask

// 兼容旧格式 group_id -> group_ids
function normalizeTask(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw.group_ids && raw.group_id) {
    return { ...raw, group_ids: [raw.group_id] }
  }
  return raw
}

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const tasks = ref<ScheduledTask[]>([])
const editOpen = ref(false)
const editIndex = ref(-1)
const editType = ref<'single' | 'cron'>('single')
const editGroupIds = ref('')
const editHour = ref(8)
const editMinute = ref(0)
const editMessage = ref('')
const editCron = ref('0 9 * * *')
const cronError = ref('')

const CRON_PRESETS = [
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每天 8:00 和 18:00', value: '0 8,18 * * *' },
  { label: '工作日 9:00', value: '0 9 * * 1-5' },
  { label: '周末 10:00', value: '0 10 * * 0,6' },
  { label: '每小时整点', value: '0 * * * *' },
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '每月 1 号 9:00', value: '0 9 1 * *' },
]

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [min, hour, dom, mon, dow] = parts

  const dowNames: Record<string, string> = {
    '0': '周日', '1': '周一', '2': '周二', '3': '周三',
    '4': '周四', '5': '周五', '6': '周六', '7': '周日',
    '1-5': '工作日', '0,6': '周末', '6,0': '周末',
  }

  function describeTime(): string {
    const m = min === '0' ? '00' : min.padStart(2, '0')
    if (hour === '*') return `每小时第 ${m} 分`
    if (hour.includes(',')) return hour.split(',').map(h => `${h}:${m}`).join('、')
    if (hour.includes('/')) {
      const step = hour.split('/')[1]
      return `每 ${step} 小时 (第 ${m} 分)`
    }
    return `${hour.padStart(2, '0')}:${m}`
  }

  if (min.includes('/')) {
    const step = min.split('/')[1]
    let scope = ''
    if (dow !== '*') scope = ` (${dowNames[dow] || dow})`
    else if (dom !== '*') scope = ` (每月 ${dom} 号)`
    return `每 ${step} 分钟${scope}`
  }

  const time = describeTime()
  const scopeParts: string[] = []

  if (mon !== '*') scopeParts.push(`${mon} 月`)
  if (dom !== '*' && !dom.includes('/')) scopeParts.push(`每月 ${dom} 号`)
  if (dow !== '*') scopeParts.push(dowNames[dow] || `星期 ${dow}`)

  if (scopeParts.length === 0 && hour !== '*') return `每天 ${time}`
  if (scopeParts.length === 0) return time

  return `${scopeParts.join(' ')} ${time}`
}

function validateCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return 'Cron 表达式需要 5 个字段：分 时 日 月 周'
  const ranges = [
    { name: '分钟', min: 0, max: 59 },
    { name: '小时', min: 0, max: 23 },
    { name: '日', min: 1, max: 31 },
    { name: '月', min: 1, max: 12 },
    { name: '星期', min: 0, max: 7 },
  ]
  for (let i = 0; i < 5; i++) {
    const p = parts[i]
    if (p === '*') continue
    const valid = /^(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?)(,(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?))*$/.test(p)
    if (!valid) return `${ranges[i].name} 字段格式无效: ${p}`
  }
  return ''
}

watch(() => props.modelValue, (val) => {
  try {
    const parsed = JSON.parse(val || '[]')
    tasks.value = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]).map(normalizeTask) as ScheduledTask[] : []
  } catch {
    tasks.value = []
  }
}, { immediate: true })

function serialize() {
  emit('update:modelValue', JSON.stringify(tasks.value))
}

function formatGroups(ids: number[]): string {
  if (ids.length <= 2) return ids.join('、')
  return `${ids[0]} 等 ${ids.length} 个群`
}

function taskSummary(task: ScheduledTask): string {
  const groups = formatGroups(task.group_ids)
  if (task.type === 'cron') {
    return `${describeCron(task.cron)} -> ${groups}`
  }
  return `${String(task.hour).padStart(2, '0')}:${String(task.minute).padStart(2, '0')} -> ${groups}`
}

function taskBadge(task: ScheduledTask): string {
  if (task.type === 'cron') return 'Cron'
  return '定时'
}

function openAdd() {
  editIndex.value = -1
  editType.value = 'single'
  editGroupIds.value = ''
  editHour.value = 8
  editMinute.value = 0
  editMessage.value = ''
  editCron.value = '0 9 * * *'
  cronError.value = ''
  editOpen.value = true
}

function openEdit(index: number) {
  const task = tasks.value[index]
  editIndex.value = index
  cronError.value = ''
  editGroupIds.value = task.group_ids.join(', ')
  if (task.type === 'cron') {
    editType.value = 'cron'
    editCron.value = task.cron
    editMessage.value = task.message
  } else {
    editType.value = 'single'
    editHour.value = task.hour
    editMinute.value = task.minute
    editMessage.value = task.message
  }
  editOpen.value = true
}

function parseGroupIds(input: string): number[] {
  return input
    .split(/[,，\s]+/)
    .map(s => parseInt(s.trim(), 10))
    .filter(n => n > 0 && !isNaN(n))
}

function saveTask() {
  const gids = parseGroupIds(editGroupIds.value)
  if (gids.length === 0) return

  let task: ScheduledTask
  if (editType.value === 'cron') {
    const err = validateCron(editCron.value)
    if (err) { cronError.value = err; return }
    if (!editMessage.value.trim()) return
    task = {
      type: 'cron',
      cron: editCron.value.trim(),
      group_ids: gids,
      message: editMessage.value.trim(),
    }
  } else {
    if (!editMessage.value.trim()) return
    task = {
      hour: editHour.value,
      minute: editMinute.value,
      group_ids: gids,
      message: editMessage.value.trim(),
    }
  }

  if (editIndex.value >= 0) {
    tasks.value[editIndex.value] = task
  } else {
    tasks.value.push(task)
  }
  serialize()
  editOpen.value = false
}

function removeTask(index: number) {
  tasks.value.splice(index, 1)
  serialize()
}

function applyPreset(preset: string) {
  editCron.value = preset
  cronError.value = ''
}

const hours = computed(() => Array.from({ length: 24 }, (_, i) => i))
const minutes = computed(() => Array.from({ length: 60 }, (_, i) => i))
const cronDescription = computed(() => editCron.value ? describeCron(editCron.value) : '')
</script>

<template>
  <div class="space-y-3">
    <!-- Task list -->
    <div v-if="tasks.length === 0" class="text-sm text-muted-foreground py-3 text-center border rounded-md">
      暂未配置定时任务
    </div>
    <div v-else class="space-y-2">
      <Card v-for="(task, i) in tasks" :key="i" class="overflow-hidden">
        <CardContent class="p-3 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <Clock class="w-4 h-4 text-muted-foreground shrink-0" />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground">{{ taskBadge(task) }}</span>
                <p class="text-sm font-medium truncate">{{ taskSummary(task) }}</p>
              </div>
              <p v-if="task.type === 'cron'" class="text-xs text-muted-foreground truncate">
                <code class="text-[10px] bg-muted px-1 rounded mr-1">{{ task.cron }}</code>{{ task.message }}
              </p>
              <p v-else class="text-xs text-muted-foreground truncate">{{ task.message }}</p>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="openEdit(i)">
              <Pencil class="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-destructive" @click="removeTask(i)">
              <Trash2 class="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <Button variant="outline" size="sm" class="w-full" @click="openAdd">
      <Plus class="w-4 h-4 mr-1" /> 添加定时任务
    </Button>

    <!-- Edit dialog -->
    <Dialog v-model:open="editOpen">
      <DialogContent class="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editIndex >= 0 ? '编辑' : '添加' }}定时任务</DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <!-- Task type -->
          <div class="space-y-2">
            <Label>任务类型</Label>
            <Select v-model="editType">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">单次定时</SelectItem>
                <SelectItem value="cron">Cron 表达式</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Group IDs -->
          <div class="space-y-2">
            <Label>目标群号</Label>
            <Input v-model="editGroupIds" placeholder="输入群号，多个用逗号分隔" />
            <p class="text-xs text-muted-foreground">支持多个群号，用逗号分隔，如：123456, 789012</p>
          </div>

          <!-- Single task fields -->
          <template v-if="editType === 'single'">
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-2">
                <Label>小时</Label>
                <Select :model-value="String(editHour)" @update:model-value="editHour = Number($event)">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="h in hours" :key="h" :value="String(h)">{{ String(h).padStart(2, '0') }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-2">
                <Label>分钟</Label>
                <Select :model-value="String(editMinute)" @update:model-value="editMinute = Number($event)">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="m in minutes" :key="m" :value="String(m)">{{ String(m).padStart(2, '0') }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div class="space-y-2">
              <Label>消息内容</Label>
              <Input v-model="editMessage" placeholder="要发送的消息，支持 {time} 等变量" />
              <p class="text-xs text-muted-foreground">
                可用变量：<code class="bg-muted px-1 rounded">{time}</code> 时:分　
                <code class="bg-muted px-1 rounded">{hour}</code> 时　
                <code class="bg-muted px-1 rounded">{date}</code> 日期　
                <code class="bg-muted px-1 rounded">{weekday}</code> 星期
              </p>
            </div>
          </template>

          <!-- Cron task fields -->
          <template v-if="editType === 'cron'">
            <div class="space-y-2">
              <Label>Cron 表达式</Label>
              <Input v-model="editCron" placeholder="分 时 日 月 周 (如 0 9 * * 1-5)" class="font-mono text-sm"
                @input="cronError = ''" />
              <p v-if="cronError" class="text-xs text-destructive">{{ cronError }}</p>
              <p v-else-if="cronDescription" class="text-xs text-muted-foreground">
                调度：{{ cronDescription }}
              </p>
            </div>
            <div class="space-y-2">
              <Label class="text-xs text-muted-foreground">常用预设</Label>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="p in CRON_PRESETS" :key="p.value"
                  class="text-xs px-2 py-1 rounded-md border hover:bg-muted transition-colors"
                  :class="editCron === p.value ? 'bg-primary/10 border-primary text-primary' : ''"
                  @click="applyPreset(p.value)">
                  {{ p.label }}
                </button>
              </div>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">格式：<code class="bg-muted px-1 rounded">分 时 日 月 周</code></p>
              <p class="text-xs text-muted-foreground"><code class="bg-muted px-1 rounded">*</code> 任意　<code class="bg-muted px-1 rounded">*/N</code> 每N　<code class="bg-muted px-1 rounded">1,3,5</code> 列举　<code class="bg-muted px-1 rounded">1-5</code> 范围</p>
            </div>
            <div class="space-y-2">
              <Label>消息内容</Label>
              <Input v-model="editMessage" placeholder="要发送的消息，支持 {time} 等变量" />
              <p class="text-xs text-muted-foreground">
                可用变量：<code class="bg-muted px-1 rounded">{time}</code> 时:分　
                <code class="bg-muted px-1 rounded">{hour}</code> 时　
                <code class="bg-muted px-1 rounded">{date}</code> 日期　
                <code class="bg-muted px-1 rounded">{weekday}</code> 星期
              </p>
            </div>
          </template>
        </div>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button @click="saveTask">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
