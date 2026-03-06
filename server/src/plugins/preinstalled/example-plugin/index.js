import { setContext, clearContext, getContext, getTarget, getPureText } from './modules/utils.js';
import { handlePing, handleEcho, handleInfo, handleTime, handleLike } from './modules/basic.js';
import { loadCheckinData, handleCheckin, handleCheckinRank } from './modules/checkin.js';
import {
  handleBan, handleUnban, handleKick, handleWholeBan,
  handleSetCard, handleGroupNotice, handleSetGroupName,
  handleSetGroupAdmin, handleSetSpecialTitle, handleLeaveGroup,
  handleDeleteMsg, handleGroupHistory, handleMarkRead,
} from './modules/admin.js';
import {
  handleGroupList, handleGroupMemberList, handleGetMemberInfo,
  handleFriendList, handleStrangerInfo, handleGroupHonor,
  handleGroupFiles, handleGroupFileInfo,
} from './modules/query.js';
import { handleNotice, cacheMessage, clearMessageCache } from './modules/notice.js';
import { handleMenu, handleFeatureList, handleFeatureToggle } from './modules/features.js';
import { CronExpressionParser } from 'cron-parser';

const repeatTracker = new Map();
const lastCronSent = new Map();

/** 解析任务中的群列表，支持 "all" → 获取所有启用群 */
async function resolveGroupIds(context, rawGroupIds) {
  if (!rawGroupIds.includes('all')) {
    return rawGroupIds.filter(id => typeof id === 'number');
  }
  try {
    const rawGroups = await context.callApi('get_group_list');
    if (!Array.isArray(rawGroups)) return [];
    const basic = context.getBotConfig('basic');
    const mode = basic?.groupFilterMode ?? 'none';
    const filterList = basic?.groupFilterList ?? [];
    return rawGroups
      .map(g => Number(g.group_id))
      .filter(gid => {
        if (mode === 'whitelist') return filterList.includes(gid);
        if (mode === 'blacklist') return !filterList.includes(gid);
        return true;
      });
  } catch (err) {
    context.logger.warn(`获取群列表失败: ${err.message || err}`);
    return [];
  }
}

/** 从任务中获取消息文本（支持 messages 数组随机选取） */
function pickTaskMessage(task) {
  if (Array.isArray(task.messages) && task.messages.length > 0) {
    return task.messages[Math.floor(Math.random() * task.messages.length)];
  }
  return task.message || null;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function renderTemplate(msg) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const pad = (n) => String(n).padStart(2, '0');
  const h = pad(now.getHours());
  const m = pad(now.getMinutes());
  const Y = now.getFullYear();
  const M = pad(now.getMonth() + 1);
  const D = pad(now.getDate());
  return msg
    .replace(/\{time}/g, `${h}:${m}`)
    .replace(/\{hour}/g, h)
    .replace(/\{minute}/g, m)
    .replace(/\{date}/g, `${Y}-${M}-${D}`)
    .replace(/\{datetime}/g, `${Y}-${M}-${D} ${h}:${m}`)
    .replace(/\{weekday}/g, WEEKDAY_NAMES[now.getDay()]);
}

function matchesCron(cronExpr, tz = 'Asia/Shanghai') {
  try {
    const expr = CronExpressionParser.parse(cronExpr, { tz });
    const prev = expr.prev().toDate();
    const now = new Date();
    return Math.floor(prev.getTime() / 60000) === Math.floor(now.getTime() / 60000);
  } catch {
    return false;
  }
}

export default {
  async onLoad(context) {
    setContext(context);
    context.logger.info('示例插件已加载');

    loadCheckinData();
    context.logger.info('签到数据已加载');

    context.setInterval(() => {
      context.logger.debug('示例插件心跳');
    }, 60000);

    context.setInterval(async () => {
      const enableScheduledMsg = context.getConfig('enableScheduledMsg') ?? false;
      if (!enableScheduledMsg) return;
      try {
        const raw = context.getConfig('scheduledMessages') ?? '[]';
        const tasks = JSON.parse(raw);
        if (!Array.isArray(tasks)) return;
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        const hour = now.getHours();
        const minute = now.getMinutes();
        const nowMinKey = Math.floor(Date.now() / 60000);

        // 缓存本轮 "all" 群列表解析结果，避免重复调 API
        let cachedAllGroups = null;

        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];
          const rawGroupIds = Array.isArray(task.group_ids) ? task.group_ids : task.group_id ? [task.group_id] : [];
          if (rawGroupIds.length === 0) continue;

          const sentKey = `${i}`;
          if (lastCronSent.get(sentKey) === nowMinKey) continue;

          const msgText = pickTaskMessage(task);
          if (!msgText) continue;

          let shouldSend = false;
          if (task.type === 'cron' && task.cron) {
            shouldSend = matchesCron(task.cron);
          } else if (task.hour === hour && task.minute === minute) {
            shouldSend = true;
          }

          if (shouldSend) {
            lastCronSent.set(sentKey, nowMinKey);
            const msg = renderTemplate(msgText);

            // 解析目标群（支持 "all" → 所有启用群）
            let groupIds;
            if (rawGroupIds.includes('all')) {
              if (cachedAllGroups === null) {
                cachedAllGroups = await resolveGroupIds(context, rawGroupIds);
              }
              groupIds = cachedAllGroups;
            } else {
              groupIds = rawGroupIds.filter(id => typeof id === 'number');
            }

            for (const gid of groupIds) {
              context.sendMessage('group', gid, msg);
            }
            const label = task.type === 'cron' ? `Cron (${task.cron})` : '定时';
            context.logger.info(`${label}消息已发送到 ${groupIds.length} 个群`);
          }
        }
      } catch (err) {
        context.logger.warn(`定时消息解析失败: ${err.message || err}`);
      }
    }, 60000);
  },

  async onUnload() {
    repeatTracker.clear();
    clearMessageCache();
    const ctx = getContext();
    if (ctx) ctx.logger.info('示例插件已卸载');
    clearContext();
  },

  async onMessage(event, connectionId) {
    const ctx = getContext();
    cacheMessage(event);

    const text = event.raw_message?.trim();
    if (!text) return;

    // 基础指令
    if (text === '/ping') return handlePing(event);
    if (text === '/菜单' || text === '/menu') return handleMenu(event);
    if (text.startsWith('/echo ')) return handleEcho(event, text.slice(6));
    if (text === '/echo') return ctx.sendMessage(event.message_type, getTarget(event), '用法: /echo <内容>');
    if (text === '/info') return handleInfo(event);
    if (text === '/time') return handleTime(event);
    if (text === '/赞我' || text === '/赞' || text === '/点赞') return handleLike(event);

    // 签到
    if (text === '/签到') {
      if (ctx.getConfig('enableCheckin') ?? false) await handleCheckin(event);
      return;
    }
    if (text === '/签到排行') {
      if (ctx.getConfig('enableCheckin') ?? false) await handleCheckinRank(event);
      return;
    }

    // 功能管理
    if (text === '/功能列表') return handleFeatureList(event);
    if (text.startsWith('/开启 ')) return handleFeatureToggle(event, text.slice(4), true);
    if (text.startsWith('/关闭 ')) return handleFeatureToggle(event, text.slice(4), false);

    // 信息查询
    if (text === '/查群员' || text.startsWith('/查群员 ')) {
      const args = text.slice(4).trim().split(/\s+/).filter(Boolean);
      return handleGetMemberInfo(event, args);
    }
    if (text.startsWith('/查用户 ')) return handleStrangerInfo(event, text.slice(4).trim());
    if (text === '/查用户') return ctx.sendMessage(event.message_type, getTarget(event), '用法: /查用户 <QQ号>');
    if (text === '/群荣誉') return handleGroupHonor(event);
    if (text === '/群文件信息') return handleGroupFileInfo(event);
    if (text === '/群文件') return handleGroupFiles(event);
    if (text === '/已读') return handleMarkRead(event);
    if (text === '/群列表') return handleGroupList(event);
    if (text === '/群成员') return handleGroupMemberList(event);
    if (text === '/好友列表') return handleFriendList(event);
    if (text === '/群历史' || text.startsWith('/群历史 ')) return handleGroupHistory(event, text.slice(4).trim());

    // 撤回（需要从纯文本匹配，因为回复消息时 raw_message 包含 CQ 码）
    if (getPureText(event) === '/撤回') await handleDeleteMsg(event);

    // 群管理指令
    const enableGroupAdmin = ctx.getConfig('enableGroupAdmin') ?? true;
    if (enableGroupAdmin) {
      const [cmd, ...args] = text.split(/\s+/);
      const argStr = args.join(' ').trim();
      switch (cmd) {
        case '/禁言': await handleBan(event, args); break;
        case '/解禁': await handleUnban(event, args); break;
        case '/踢': await handleKick(event, args); break;
        case '/全员禁言': await handleWholeBan(event, true); break;
        case '/解除全员禁言': await handleWholeBan(event, false); break;
        case '/群名片': await handleSetCard(event, args, argStr); break;
        case '/群公告': await handleGroupNotice(event, argStr); break;
        case '/改群名': await handleSetGroupName(event, argStr); break;
        case '/设管理': await handleSetGroupAdmin(event, true, args); break;
        case '/取消管理': await handleSetGroupAdmin(event, false, args); break;
        case '/头衔': await handleSetSpecialTitle(event, args, argStr); break;
        case '/退群': await handleLeaveGroup(event, argStr); break;
      }
    }

    // 复读检测 — 仅群聊
    if (event.message_type === 'group' && text) {
      const enableRepeat = ctx.getConfig('enableRepeat') ?? false;
      if (enableRepeat) {
        const groupId = event.group_id;
        const prev = repeatTracker.get(groupId);
        if (prev && prev.text === text) {
          prev.count += 1;
          const threshold = ctx.getConfig('repeatThreshold') ?? 3;
          if (prev.count >= threshold && !prev.replied) {
            prev.replied = true;
            await ctx.sendMessage('group', groupId, text);
          }
        } else {
          repeatTracker.set(groupId, { text, count: 1, replied: false });
        }
      }
    }
  },

  async onNotice(event, connectionId) {
    await handleNotice(event);
  },
};
