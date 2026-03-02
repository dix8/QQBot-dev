<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'vue-sonner'
import { Shield, Plus, X } from 'lucide-vue-next'
import { getSuperAdmins, setSuperAdmins } from '@/api/system'

const superAdmins = ref<number[]>([])
const newQQ = ref('')
const loading = ref(true)
const saving = ref(false)

onMounted(async () => {
  try {
    superAdmins.value = await getSuperAdmins()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '加载超级管理员列表失败')
  } finally {
    loading.value = false
  }
})

async function addSuperAdmin() {
  const qq = parseInt(newQQ.value.trim(), 10)
  if (!qq || isNaN(qq) || qq <= 0) {
    toast.error('请输入有效的 QQ 号')
    return
  }
  if (superAdmins.value.includes(qq)) {
    toast.error(`QQ ${qq} 已在列表中`)
    return
  }
  const updated = [...superAdmins.value, qq]
  saving.value = true
  try {
    await setSuperAdmins(updated)
    superAdmins.value = updated
    newQQ.value = ''
    toast.success(`已添加超级管理员: ${qq}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '添加失败')
  } finally {
    saving.value = false
  }
}

async function removeSuperAdmin(qq: number) {
  const updated = superAdmins.value.filter(q => q !== qq)
  saving.value = true
  try {
    await setSuperAdmins(updated)
    superAdmins.value = updated
    toast.success(`已移除超级管理员: ${qq}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '移除失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold">系统设置</h1>
      <p class="text-sm text-muted-foreground mt-1">管理系统级别的配置</p>
    </div>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Shield class="w-5 h-5" />
          <CardTitle>超级管理员</CardTitle>
        </div>
        <CardDescription>
          超级管理员拥有最高权限，可执行所有指令（包括添加/删除主人、管理插件等）。权限层级：超级管理员 &gt; 主人 &gt; 所有人
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loading" class="text-sm text-muted-foreground">加载中...</div>
        <div v-else class="space-y-4">
          <!-- Add form -->
          <div class="flex items-center gap-2">
            <Input
              v-model="newQQ"
              placeholder="输入 QQ 号"
              class="max-w-xs"
              @keyup.enter="addSuperAdmin"
            />
            <Button size="sm" :disabled="saving || !newQQ.trim()" @click="addSuperAdmin">
              <Plus class="w-4 h-4 mr-1" />
              添加
            </Button>
          </div>

          <!-- List -->
          <div v-if="superAdmins.length === 0" class="text-sm text-muted-foreground py-4 text-center">
            暂未设置超级管理员
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="qq in superAdmins"
              :key="qq"
              class="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50"
            >
              <span class="text-sm font-mono">{{ qq }}</span>
              <Button
                variant="ghost"
                size="sm"
                :disabled="saving"
                @click="removeSuperAdmin(qq)"
              >
                <X class="w-4 h-4 text-red-500" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
