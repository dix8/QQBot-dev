// 示例插件 — 演示所有插件系统能力
// 可自由启用/禁用/删除，作为插件开发的完整参考

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

let ctx;

/** 从 dataDir 读取调用计数 */
function readCounter() {
  const file = join(ctx.dataDir, 'counter.json');
  if (!existsSync(file)) return 0;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')).count || 0;
  } catch {
    return 0;
  }
}

/** 写入调用计数到 dataDir */
function writeCounter(count) {
  const file = join(ctx.dataDir, 'counter.json');
  writeFileSync(file, JSON.stringify({ count }), 'utf-8');
}

/** 获取消息发送目标 */
function getTarget(event) {
  return event.message_type === 'private' ? event.user_id : event.group_id;
}

// ==================== 指令处理 ====================

async function handlePing(event) {
  await ctx.sendMessage(event.message_type, getTarget(event), 'pong 🏓');
}

async function handleEcho(event, content) {
  const maxLen = ctx.getConfig('maxEchoLen') ?? 100;
  if (content.length > maxLen) {
    await ctx.sendMessage(event.message_type, getTarget(event),
      `消息太长了（${content.length}/${maxLen}），不复读`);
    return;
  }

  const mode = ctx.getConfig('echoMode') ?? 'text';
  if (mode === 'raw') {
    // 原样转发：使用原始消息段
    await ctx.sendMessage(event.message_type, getTarget(event), event.message);
  } else {
    // 纯文本模式
    await ctx.sendMessage(event.message_type, getTarget(event), content);
  }
}

async function handleInfo(event) {
  try {
    const info = await ctx.callApi('get_login_info');
    const msg = `Bot 信息:\nQQ: ${info.user_id}\n昵称: ${info.nickname}`;
    await ctx.sendMessage(event.message_type, getTarget(event), msg);
  } catch (err) {
    await ctx.sendMessage(event.message_type, getTarget(event),
      `获取信息失败: ${err.message || err}`);
  }
}

async function handleTime(event) {
  const count = readCounter() + 1;
  writeCounter(count);
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  await ctx.sendMessage(event.message_type, getTarget(event),
    `当前时间: ${now}\n/time 已被调用 ${count} 次`);
}

// ==================== 生命周期 ====================

export default {
  async onLoad(context) {
    ctx = context;
    ctx.logger.info('示例插件已加载');
    const count = readCounter();
    ctx.logger.info(`dataDir 历史调用计数: ${count}`);
  },

  async onUnload() {
    if (ctx) {
      ctx.logger.info('示例插件已卸载');
    }
    ctx = null;
  },

  async onMessage(event, connectionId) {
    const text = event.raw_message?.trim();
    if (!text) return;

    if (text === '/ping') {
      await handlePing(event);
    } else if (text.startsWith('/echo ')) {
      await handleEcho(event, text.slice(6));
    } else if (text === '/echo') {
      await ctx.sendMessage(event.message_type, getTarget(event),
        '用法: /echo <内容>');
    } else if (text === '/info') {
      await handleInfo(event);
    } else if (text === '/time') {
      await handleTime(event);
    }
  },

  async onNotice(event, connectionId) {
    // 群成员增加时发送欢迎消息
    if (event.notice_type === 'group_increase' && event.group_id && event.user_id) {
      const welcomeMsg = ctx.getConfig('welcomeMsg') ?? '欢迎加入！';
      await ctx.sendMessage('group', event.group_id, [
        { type: 'at', data: { qq: String(event.user_id) } },
        { type: 'text', data: { text: ` ${welcomeMsg}` } },
      ]);
    }
  },

  async onRequest(event, connectionId) {
    // 好友请求自动同意
    if (event.request_type === 'friend') {
      const autoApprove = ctx.getConfig('autoApprove') ?? false;
      if (autoApprove) {
        await ctx.callApi('set_friend_add_request', {
          flag: event.flag,
          approve: true,
        });
        ctx.logger.info(`已自动通过好友请求: ${event.user_id}`);
      }
    }
  },
};
