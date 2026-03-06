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

const repeatTracker = new Map();

export default {
  async onLoad(context) {
    setContext(context);
    context.logger.info('示例插件已加载');

    loadCheckinData();
    context.logger.info('签到数据已加载');

    context.setInterval(() => {
      context.logger.debug('示例插件心跳');
    }, 60000);

    context.setInterval(() => {
      const enableScheduledMsg = context.getConfig('enableScheduledMsg') ?? false;
      if (!enableScheduledMsg) return;
      try {
        const raw = context.getConfig('scheduledMessages') ?? '[]';
        const tasks = JSON.parse(raw);
        if (!Array.isArray(tasks)) return;
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        const hour = now.getHours();
        const minute = now.getMinutes();
        for (const task of tasks) {
          if (!task.group_id) continue;
          if (task.type === 'hourly' && Array.isArray(task.messages)) {
            const taskMinute = task.minute ?? 0;
            if (minute === taskMinute && hour >= 0 && hour < task.messages.length && task.messages[hour]) {
              context.sendMessage('group', task.group_id, task.messages[hour]);
              context.logger.info(`整点报时已发送到群 ${task.group_id}`);
            }
          } else if (task.hour === hour && task.minute === minute && task.message) {
            context.sendMessage('group', task.group_id, task.message);
            context.logger.info(`定时消息已发送到群 ${task.group_id}`);
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
