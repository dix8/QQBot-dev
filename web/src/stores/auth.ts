import { defineStore } from 'pinia'
import { computed } from 'vue'
import { apiFetch, getToken, setToken, clearToken } from '@/api/client'
import router from '@/router'

interface LoginResponse {
  token: string
  username: string
  changePasswordHint: boolean
}

interface MeResponse {
  id: number
  username: string
  changePasswordHint: boolean
}

export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = computed(() => !!getToken())

  async function login(username: string, password: string): Promise<LoginResponse> {
    const data = await apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setToken(data.token)
    return data
  }

  function logout() {
    clearToken()
    router.push('/login')
  }

  async function checkAuth(): Promise<MeResponse> {
    return apiFetch<MeResponse>('/api/auth/me')
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  }

  async function changeUsername(newUsername: string): Promise<void> {
    const data = await apiFetch<{ token: string; username: string }>('/api/auth/change-username', {
      method: 'POST',
      body: JSON.stringify({ newUsername }),
    })
    setToken(data.token)
  }

  return { isAuthenticated, login, logout, checkAuth, changePassword, changeUsername }
})
