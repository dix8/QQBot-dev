import type { FastifyInstance } from 'fastify';
import { auditService } from '../services/audit.js';
import { authService } from '../services/auth.js';
import { logService } from '../services/log.js';
import { notificationService } from '../services/notification.js';

const LOGIN_DELAY_MS = 3000;

/** IP-based login rate limit: max failures within a window */
const LOGIN_RATE_LIMIT_MAX = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const loginFailures = new Map<string, number[]>();

function isLoginRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - LOGIN_RATE_LIMIT_WINDOW_MS;
  let timestamps = loginFailures.get(ip);
  if (!timestamps) return false;
  // Remove expired entries
  timestamps = timestamps.filter((t) => t > cutoff);
  if (timestamps.length === 0) {
    loginFailures.delete(ip);
    return false;
  }
  loginFailures.set(ip, timestamps);
  return timestamps.length >= LOGIN_RATE_LIMIT_MAX;
}

function recordLoginFailure(ip: string): void {
  let timestamps = loginFailures.get(ip);
  if (!timestamps) {
    timestamps = [];
    loginFailures.set(ip, timestamps);
  }
  timestamps.push(Date.now());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function authRoutes(fastify: FastifyInstance): void {
  // Login
  fastify.post<{
    Body: { username: string; password: string };
  }>('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {};

    if (!username || !password) {
      return reply.code(400).send({ error: '请提供用户名和密码' });
    }

    // IP-based rate limit check
    if (isLoginRateLimited(request.ip)) {
      logService.addLog('warn', 'auth', `登录限流: IP ${request.ip} 短时间内失败次数过多`);
      notificationService.add('login_failed', 'warning', '登录限流', `IP ${request.ip} 短时间内失败次数过多`);
      return reply.code(429).send({ error: '登录失败次数过多，请 5 分钟后再试' });
    }

    const user = await authService.validateLogin(username, password);

    if (!user) {
      recordLoginFailure(request.ip);
      // Delay to mitigate brute-force attacks
      await delay(LOGIN_DELAY_MS);
      logService.addLog('warn', 'auth', `登录失败: 用户名 "${username}"，用户名或密码错误 (IP: ${request.ip})`);
      return reply.code(401).send({ error: '用户名或密码错误' });
    }

    const token = fastify.jwt.sign({ sub: user.id, username: user.username });
    const changePasswordHint = authService.isDefaultPassword(user.id);

    auditService.log('login', user.username, '登录成功', user.username, request.ip);
    return { token, username: user.username, changePasswordHint };
  });

  // Get current user info
  fastify.get('/api/auth/me', async (request) => {
    const { sub, username } = request.user;
    const changePasswordHint = authService.isDefaultPassword(sub);
    return { id: sub, username, changePasswordHint };
  });

  // Change password
  fastify.post<{
    Body: { currentPassword: string; newPassword: string };
  }>('/api/auth/change-password', async (request, reply) => {
    const { currentPassword, newPassword } = request.body ?? {};

    if (!currentPassword || !newPassword) {
      return reply.code(400).send({ error: '请提供当前密码和新密码' });
    }

    if (newPassword.length < 8) {
      return reply.code(400).send({ error: '新密码长度不能少于 8 位' });
    }

    if (currentPassword === newPassword) {
      return reply.code(400).send({ error: '新密码不能与当前密码相同' });
    }

    const success = await authService.changePassword(request.user.sub, currentPassword, newPassword);

    if (!success) {
      logService.addLog('warn', 'auth', `密码修改失败: 用户 "${request.user.username}"，当前密码错误 (IP: ${request.ip})`);
      return reply.code(400).send({ error: '当前密码错误' });
    }

    auditService.log('password_change', String(request.user.sub), '修改密码', request.user.username, request.ip);
    return { success: true, message: '密码修改成功' };
  });

  // Change username
  fastify.post<{
    Body: { newUsername: string };
  }>('/api/auth/change-username', async (request, reply) => {
    const { newUsername } = request.body ?? {};

    if (!newUsername || newUsername.trim().length < 2) {
      return reply.code(400).send({ error: '用户名至少 2 个字符' });
    }

    const success = authService.changeUsername(request.user.sub, newUsername.trim());

    if (!success) {
      logService.addLog('warn', 'auth', `用户名修改失败: 用户 "${request.user.username}"，用户名 "${newUsername.trim()}" 已被占用 (IP: ${request.ip})`);
      return reply.code(400).send({ error: '用户名已被占用' });
    }

    // Issue a new token with updated username
    const token = fastify.jwt.sign({ sub: request.user.sub, username: newUsername.trim() });

    auditService.log('username_change', String(request.user.sub), `"${request.user.username}" → "${newUsername.trim()}"`, request.user.username, request.ip);
    return { success: true, message: '用户名修改成功', token, username: newUsername.trim() };
  });
}
