// 示例插件 — 演示所有插件系统能力
// 可自由启用/禁用/删除，作为插件开发的完整参考

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

let ctx;

// ==================== 复读检测状态 (E8) ====================
// Map<group_id, { text: string, count: number, replied: boolean }>
const repeatTracker = new Map();

// ==================== 消息缓存（防撤回用） ====================
// Map<message_id, { sender: string, userId: number, message: array, time: number }>
const messageCache = new Map();
const MESSAGE_CACHE_MAX = 500;

// ==================== 签到数据 (E9) ====================
// 运行时缓存，启动时从 dataDir 加载
let checkinData = {};
// { [group_id]: { [user_id]: { total: number, streak: number, lastDate: string } } }

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

/** 从 dataDir 读取签到数据 */
function loadCheckinData() {
  const file = join(ctx.dataDir, 'checkin.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

/** 写入签到数据到 dataDir */
function saveCheckinData() {
  const file = join(ctx.dataDir, 'checkin.json');
  writeFileSync(file, JSON.stringify(checkinData), 'utf-8');
}

/** 获取今天日期字符串（YYYY-MM-DD） */
function getTodayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

/** 获取消息发送目标 */
function getTarget(event) {
  return event.message_type === 'private' ? event.user_id : event.group_id;
}

/** 从戳一戳回复语配置中随机选一条 */
function randomPokeReply() {
  const raw = ctx.getConfig('pokeReplies') ?? '别戳了！|戳你一下！|干嘛戳我 >_<|再戳就坏了！|你好呀~';
  const replies = raw.split('|').map((s) => s.trim()).filter(Boolean);
  if (replies.length === 0) return '别戳了！';
  return replies[Math.floor(Math.random() * replies.length)];
}

/** 将消息段数组转为可读文本（用于防撤回等场景），返回空字符串表示无内容 */
function formatMessageContent(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  if (!Array.isArray(message) || message.length === 0) return '';

  return message.map((seg) => {
    switch (seg.type) {
      case 'text': return seg.data?.text || '';
      case 'image': return '[图片]';
      case 'face': return '[表情]';
      case 'at': return seg.data?.qq === 'all' ? '@全体成员' : `@${seg.data?.qq}`;
      case 'reply': return '';
      case 'record': return '[语音]';
      case 'video': return '[视频]';
      case 'json': return '[JSON消息]';
      case 'xml': return '[XML消息]';
      case 'forward': return '[转发消息]';
      case 'file': return '[文件]';
      case 'mface': return '[表情包]';
      case 'rps': return '[猜拳]';
      case 'dice': return '[骰子]';
      case 'poke': return '[戳一戳]';
      case 'share': return `[分享: ${seg.data?.title || ''}]`;
      case 'music': return '[音乐]';
      case 'location': return '[位置]';
      default: return `[${seg.type}]`;
    }
  }).join('');
}

// ==================== 指令处理 ====================

/** 可通过指令开关的功能列表：[configKey, 中文标签] */
const TOGGLE_FEATURES = [
  ['enableGroupAdmin', '群管理指令'],
  ['enableWelcome', '入群欢迎'],
  ['enableLeaveNotice', '退群通知'],
  ['enablePokeReply', '戳一戳回应'],
  ['enableAntiRecall', '防撤回'],
  ['enableAdminNotice', '管理员变动通知'],
  ['enableBanNotice', '禁言通知'],
  ['enableFriendWelcome', '新好友欢迎'],
  ['enableFileNotice', '群文件上传通知'],
  ['enableHonorNotice', '荣誉变更通知'],
  ['enableLuckyKing', '运气王播报'],
  ['enableRepeat', '复读检测'],
  ['enableCheckin', '每日签到'],
  ['enableScheduledMsg', '定时消息'],
];

/** 从消息段中提取第一个 AT 目标 QQ */
function getAtTarget(event) {
  const message = event.message;
  if (!Array.isArray(message)) return undefined;
  const atSeg = message.find((seg) => seg.type === 'at' && seg.data.qq !== 'all');
  if (atSeg) {
    const qq = parseInt(String(atSeg.data.qq), 10);
    return isNaN(qq) ? undefined : qq;
  }
  return undefined;
}

/** 从消息段中提取回复消息的 ID */
function getReplyMessageId(event) {
  const message = event.message;
  if (!Array.isArray(message)) return undefined;
  const replySeg = message.find((seg) => seg.type === 'reply');
  if (replySeg) {
    const id = parseInt(String(replySeg.data.id), 10);
    return isNaN(id) ? undefined : id;
  }
  return undefined;
}

/** 从消息段中提取纯文本内容（去除 CQ 码） */
function getPureText(event) {
  const message = event.message;
  if (!Array.isArray(message)) return event.raw_message?.trim() || '';
  return message
    .filter((seg) => seg.type === 'text')
    .map((seg) => seg.data?.text || '')
    .join('')
    .trim();
}

/** 检查用户是否为主人或超级管理员 */
function isMaster(userId) {
  // 超级管理员视为主人
  const superAdmins = ctx.getBotConfig('superAdmins');
  if (Array.isArray(superAdmins) && superAdmins.includes(userId)) return true;
  // 检查 bot 级别的主人列表
  const basic = ctx.getBotConfig('basic');
  if (basic && Array.isArray(basic.masterQQ)) return basic.masterQQ.includes(userId);
  return false;
}

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
    await ctx.sendMessage(event.message_type, getTarget(event), event.message);
  } else {
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

async function handleLike(event) {
  try {
    await ctx.callApi('send_like', { user_id: event.user_id, times: 10 });
    await ctx.sendMessage(event.message_type, getTarget(event), '已给你点赞 10 次 👍');
  } catch (err) {
    await ctx.sendMessage(event.message_type, getTarget(event),
      `点赞失败: ${err.message || err}`);
  }
}

// ==================== 签到指令 (E9) ====================

async function handleCheckin(event) {
  if (event.message_type !== 'group') {
    await ctx.sendMessage('private', event.user_id, '签到功能仅支持群聊');
    return;
  }
  const groupId = String(event.group_id);
  const userId = String(event.user_id);
  const today = getTodayStr();

  if (!checkinData[groupId]) checkinData[groupId] = {};
  const userData = checkinData[groupId][userId] || { total: 0, streak: 0, lastDate: '' };

  if (userData.lastDate === today) {
    await ctx.sendMessage('group', event.group_id, [
      { type: 'at', data: { qq: String(event.user_id) } },
      { type: 'text', data: { text: ' 你今天已经签到过了！' } },
    ]);
    return;
  }

  // 判断连续签到
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const isConsecutive = userData.lastDate === yesterdayStr;

  userData.total += 1;
  userData.streak = isConsecutive ? userData.streak + 1 : 1;
  userData.lastDate = today;
  checkinData[groupId][userId] = userData;
  saveCheckinData();

  await ctx.sendMessage('group', event.group_id, [
    { type: 'at', data: { qq: String(event.user_id) } },
    { type: 'text', data: { text: ` 签到成功！\n连续签到: ${userData.streak} 天\n累计签到: ${userData.total} 天` } },
  ]);
}

async function handleCheckinRank(event) {
  if (event.message_type !== 'group') {
    await ctx.sendMessage('private', event.user_id, '签到排行仅支持群聊');
    return;
  }
  const groupId = String(event.group_id);
  const groupData = checkinData[groupId];
  if (!groupData || Object.keys(groupData).length === 0) {
    await ctx.sendMessage('group', event.group_id, '本群暂无签到记录');
    return;
  }

  const sorted = Object.entries(groupData)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  const lines = sorted.map(([uid, data], i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} ${uid} — 累计 ${data.total} 天，连续 ${data.streak} 天`;
  });

  await ctx.sendMessage('group', event.group_id, `签到排行榜 Top10\n${lines.join('\n')}`);
}

// ==================== 群管理指令 ====================

async function replyMsg(event, text) {
  await ctx.sendMessage(event.message_type, getTarget(event), text);
}

async function handleBan(event, args) {
  if (!isMaster(event.user_id)) {
    return replyMsg(event, '权限不足：仅主人可使用此指令');
  }
  if (event.message_type !== 'group') {
    return replyMsg(event, '此指令仅在群聊中可用');
  }
  const targetQQ = getAtTarget(event);
  if (!targetQQ) {
    return replyMsg(event, '请 @ 要禁言的用户，例如: /禁言 @用户 10');
  }
  const durationArg = args.find((a) => /^\d+$/.test(a));
  const minutes = durationArg ? parseInt(durationArg, 10) : 10;
  const durationSec = Math.max(1, Math.min(minutes, 43200)) * 60;
  try {
    await ctx.callApi('set_group_ban', { group_id: event.group_id, user_id: targetQQ, duration: durationSec });
    await replyMsg(event, `已禁言 ${targetQQ}，时长 ${minutes} 分钟`);
  } catch (err) {
    await replyMsg(event, `禁言失败: ${err.message || err}`);
  }
}

async function handleUnban(event) {
  if (!isMaster(event.user_id)) {
    return replyMsg(event, '权限不足：仅主人可使用此指令');
  }
  if (event.message_type !== 'group') {
    return replyMsg(event, '此指令仅在群聊中可用');
  }
  const targetQQ = getAtTarget(event);
  if (!targetQQ) {
    return replyMsg(event, '请 @ 要解禁的用户，例如: /解禁 @用户');
  }
  try {
    await ctx.callApi('set_group_ban', { group_id: event.group_id, user_id: targetQQ, duration: 0 });
    await replyMsg(event, `已解除 ${targetQQ} 的禁言`);
  } catch (err) {
    await replyMsg(event, `解禁失败: ${err.message || err}`);
  }
}

async function handleKick(event) {
  if (!isMaster(event.user_id)) {
    return replyMsg(event, '权限不足：仅主人可使用此指令');
  }
  if (event.message_type !== 'group') {
    return replyMsg(event, '此指令仅在群聊中可用');
  }
  const targetQQ = getAtTarget(event);
  if (!targetQQ) {
    return replyMsg(event, '请 @ 要踢出的用户，例如: /踢 @用户');
  }
  try {
    await ctx.callApi('set_group_kick', { group_id: event.group_id, user_id: targetQQ, reject_add_request: false });
    await replyMsg(event, `已将 ${targetQQ} 踢出群聊`);
  } catch (err) {
    await replyMsg(event, `踢人失败: ${err.message || err}`);
  }
}

async function handleWholeBan(event, enable) {
  if (!isMaster(event.user_id)) {
    return replyMsg(event, '权限不足：仅主人可使用此指令');
  }
  if (event.message_type !== 'group') {
    return replyMsg(event, '此指令仅在群聊中可用');
  }
  try {
    await ctx.callApi('set_group_whole_ban', { group_id: event.group_id, enable });
    await replyMsg(event, enable ? '已开启全员禁言' : '已解除全员禁言');
  } catch (err) {
    await replyMsg(event, `操作失败: ${err.message || err}`);
  }
}

async function handleSetCard(event, argStr) {
  if (!isMaster(event.user_id)) {
    return replyMsg(event, '权限不足：仅主人可使用此指令');
  }
  if (event.message_type !== 'group') {
    return replyMsg(event, '此指令仅在群聊中可用');
  }
  const targetQQ = getAtTarget(event);
  if (!targetQQ) {
    return replyMsg(event, '请 @ 要设置名片的用户，例如: /群名片 @用户 新名片');
  }
  const card = argStr.replace(/\[CQ:at,[^\]]*\]/g, '').trim();
  if (!card) {
    return replyMsg(event, '请输入新名片内容，例如: /群名片 @用户 新名片');
  }
  try {
    await ctx.callApi('set_group_card', { group_id: event.group_id, user_id: targetQQ, card });
    await replyMsg(event, `已将 ${targetQQ} 的群名片设置为: ${card}`);
  } catch (err) {
    await replyMsg(event, `设置名片失败: ${err.message || err}`);
  }
}

// ==================== 群管理扩展指令 ====================

async function handleGroupNotice(event, content) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  if (!content) return replyMsg(event, '用法: /群公告 <公告内容>');
  try {
    await ctx.callApi('_send_group_notice', { group_id: event.group_id, content });
    await replyMsg(event, '群公告已发布');
  } catch (err) {
    await replyMsg(event, `发布群公告失败: ${err.message || err}`);
  }
}

async function handleSetGroupName(event, name) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  if (!name) return replyMsg(event, '用法: /改群名 <新群名>');
  try {
    await ctx.callApi('set_group_name', { group_id: event.group_id, group_name: name });
    await replyMsg(event, `群名已修改为: ${name}`);
  } catch (err) {
    await replyMsg(event, `修改群名失败: ${err.message || err}`);
  }
}

async function handleSetGroupAdmin(event, enable) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  const targetQQ = getAtTarget(event);
  if (!targetQQ) return replyMsg(event, `请 @ 要${enable ? '设为' : '取消'}管理员的用户`);
  try {
    await ctx.callApi('set_group_admin', { group_id: event.group_id, user_id: targetQQ, enable });
    await replyMsg(event, `已${enable ? '设置' : '取消'} ${targetQQ} 的管理员`);
  } catch (err) {
    await replyMsg(event, `操作失败: ${err.message || err}`);
  }
}

async function handleSetSpecialTitle(event, argStr) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  const targetQQ = getAtTarget(event);
  if (!targetQQ) return replyMsg(event, '请 @ 要设置头衔的用户，例如: /头衔 @用户 头衔内容');
  const title = argStr.replace(/\[CQ:at,[^\]]*\]/g, '').trim();
  try {
    await ctx.callApi('set_group_special_title', { group_id: event.group_id, user_id: targetQQ, special_title: title, duration: -1 });
    await replyMsg(event, title ? `已将 ${targetQQ} 的头衔设置为: ${title}` : `已清除 ${targetQQ} 的头衔`);
  } catch (err) {
    await replyMsg(event, `设置头衔失败: ${err.message || err}`);
  }
}

async function handleLeaveGroup(event, argStr) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  let groupId;
  if (argStr && /^\d+$/.test(argStr)) {
    groupId = parseInt(argStr, 10);
  } else if (event.message_type === 'group') {
    groupId = event.group_id;
  } else {
    return replyMsg(event, '用法: /退群 <群号>');
  }
  try {
    if (groupId !== event.group_id) {
      await replyMsg(event, `正在退出群 ${groupId}...`);
    }
    await ctx.callApi('set_group_leave', { group_id: groupId, is_dismiss: false });
  } catch (err) {
    await replyMsg(event, `退群失败: ${err.message || err}`);
  }
}

// ==================== 信息查询指令 ====================

async function handleGroupList(event) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  try {
    const groups = await ctx.callApi('get_group_list');
    if (!Array.isArray(groups) || groups.length === 0) {
      return replyMsg(event, '当前没有加入任何群');
    }
    const lines = [`=== 群列表 (共 ${groups.length} 个) ===`];
    const show = groups.slice(0, 20);
    for (const g of show) {
      lines.push(`${g.group_id} — ${g.group_name || '(未知)'} (${g.member_count || '?'}人)`);
    }
    if (groups.length > 20) lines.push(`... 等共 ${groups.length} 个群`);
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `获取群列表失败: ${err.message || err}`);
  }
}

async function handleGroupMemberList(event) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  try {
    const members = await ctx.callApi('get_group_member_list', { group_id: event.group_id });
    if (!Array.isArray(members) || members.length === 0) {
      return replyMsg(event, '获取群成员列表为空');
    }
    const owner = members.filter((m) => m.role === 'owner');
    const admins = members.filter((m) => m.role === 'admin');
    const lines = [
      '=== 群成员统计 ===',
      `总人数: ${members.length}`,
      `群主: ${owner.map((m) => `${m.card || m.nickname}(${m.user_id})`).join(', ') || '无'}`,
      `管理员: ${admins.length} 人`,
    ];
    if (admins.length > 0 && admins.length <= 20) {
      for (const m of admins) {
        lines.push(`  ${m.card || m.nickname}(${m.user_id})`);
      }
    }
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `获取群成员列表失败: ${err.message || err}`);
  }
}

async function handleGetMemberInfo(event) {
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  const targetQQ = getAtTarget(event);
  if (!targetQQ) return replyMsg(event, '请 @ 要查询的用户');
  try {
    const info = await ctx.callApi('get_group_member_info', { group_id: event.group_id, user_id: targetQQ, no_cache: true });
    const joinTime = info.join_time ? new Date(info.join_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知';
    const lastSent = info.last_sent_time ? new Date(info.last_sent_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知';
    const roleMap = { owner: '群主', admin: '管理员', member: '成员' };
    const lines = [
      '=== 群成员信息 ===',
      `QQ: ${info.user_id}`,
      `昵称: ${info.nickname || '未知'}`,
      `群名片: ${info.card || '(无)'}`,
      `身份: ${roleMap[info.role] || info.role || '未知'}`,
      `入群时间: ${joinTime}`,
      `最后发言: ${lastSent}`,
      `等级: ${info.level || '未知'}`,
    ];
    if (info.title) lines.push(`头衔: ${info.title}`);
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `查询失败: ${err.message || err}`);
  }
}

async function handleFriendList(event) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  try {
    const friends = await ctx.callApi('get_friend_list');
    if (!Array.isArray(friends) || friends.length === 0) {
      return replyMsg(event, '好友列表为空');
    }
    const lines = [`=== 好友列表 (共 ${friends.length} 人) ===`];
    const show = friends.slice(0, 20);
    for (const f of show) {
      lines.push(`${f.user_id} — ${f.remark || f.nickname || '(未知)'}`);
    }
    if (friends.length > 20) lines.push(`... 等共 ${friends.length} 人`);
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `获取好友列表失败: ${err.message || err}`);
  }
}

async function handleStrangerInfo(event, qqStr) {
  if (!qqStr || !/^\d+$/.test(qqStr)) return replyMsg(event, '用法: /查用户 <QQ号>');
  try {
    const info = await ctx.callApi('get_stranger_info', { user_id: parseInt(qqStr, 10), no_cache: true });
    const sexMap = { male: '男', female: '女' };
    const lines = [
      '=== 用户信息 ===',
      `QQ: ${info.user_id}`,
      `昵称: ${info.nickname || '未知'}`,
      `性别: ${sexMap[info.sex] || '未知'}`,
      `年龄: ${info.age || '未知'}`,
    ];
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `查询失败: ${err.message || err}`);
  }
}

async function handleGroupHonor(event) {
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  try {
    const honor = await ctx.callApi('get_group_honor_info', { group_id: event.group_id, type: 'all' });
    const lines = ['=== 群荣誉信息 ==='];
    if (honor.current_talkative) {
      const t = honor.current_talkative;
      lines.push(`当前龙王: ${t.nickname || t.user_id} (${t.day_count || 0}天)`);
    }
    if (honor.talkative_list?.length > 0) {
      lines.push('', '历史龙王:');
      for (const t of honor.talkative_list.slice(0, 5)) {
        lines.push(`  ${t.nickname || t.user_id} — ${t.day_count || 0}天`);
      }
    }
    if (honor.performer_list?.length > 0) {
      lines.push('', '群聊之火:');
      for (const p of honor.performer_list.slice(0, 5)) {
        lines.push(`  ${p.nickname || p.user_id}`);
      }
    }
    if (honor.emotion_list?.length > 0) {
      lines.push('', '快乐源泉:');
      for (const e of honor.emotion_list.slice(0, 5)) {
        lines.push(`  ${e.nickname || e.user_id}`);
      }
    }
    if (lines.length === 1) lines.push('暂无荣誉信息');
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `获取群荣誉失败: ${err.message || err}`);
  }
}

// ==================== 消息操作指令 ====================

async function handleDeleteMsg(event) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  const replyId = getReplyMessageId(event);
  if (!replyId) return replyMsg(event, '请回复要撤回的消息后输入 /撤回');
  try {
    await ctx.callApi('delete_msg', { message_id: replyId });
  } catch (err) {
    await replyMsg(event, `撤回失败: ${err.message || err}`);
  }
}

async function handleGroupHistory(event, countStr) {
  if (!isMaster(event.user_id)) return replyMsg(event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  const count = Math.min(Math.max(parseInt(countStr, 10) || 5, 1), 20);
  try {
    const result = await ctx.callApi('get_group_msg_history', { group_id: event.group_id, count });
    const messages = result?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return replyMsg(event, '没有获取到历史消息');
    }
    const lines = [`=== 最近 ${messages.length} 条消息 ===`];
    for (const msg of messages.slice(-count)) {
      const sender = msg.sender?.card || msg.sender?.nickname || String(msg.user_id);
      const text = typeof msg.raw_message === 'string' ? msg.raw_message.slice(0, 80) : '(非文本)';
      const time = msg.time ? new Date(msg.time * 1000).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
      lines.push(`[${time}] ${sender}: ${text}`);
    }
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `获取历史消息失败: ${err.message || err}`);
  }
}

async function handleMarkRead(event) {
  try {
    if (event.message_type === 'group') {
      await ctx.callApi('mark_msg_as_read', { group_id: event.group_id });
    } else {
      await ctx.callApi('mark_msg_as_read', { user_id: event.user_id });
    }
    await replyMsg(event, '已标记消息为已读');
  } catch (err) {
    await replyMsg(event, `标记已读失败: ${err.message || err}`);
  }
}

// ==================== 群文件指令 ====================

async function handleGroupFiles(event) {
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  try {
    const result = await ctx.callApi('get_group_root_files', { group_id: event.group_id });
    const files = result?.files || [];
    const folders = result?.folders || [];
    const lines = ['=== 群文件 ==='];
    if (folders.length > 0) {
      lines.push(`📁 文件夹 (${folders.length} 个):`);
      for (const f of folders.slice(0, 10)) {
        lines.push(`  📁 ${f.folder_name}`);
      }
      if (folders.length > 10) lines.push(`  ... 共 ${folders.length} 个文件夹`);
    }
    if (files.length > 0) {
      lines.push(`📄 文件 (${files.length} 个):`);
      for (const f of files.slice(0, 10)) {
        const size = f.file_size < 1024 * 1024
          ? `${(f.file_size / 1024).toFixed(1)}KB`
          : `${(f.file_size / (1024 * 1024)).toFixed(1)}MB`;
        lines.push(`  📄 ${f.file_name} (${size})`);
      }
      if (files.length > 10) lines.push(`  ... 共 ${files.length} 个文件`);
    }
    if (files.length === 0 && folders.length === 0) lines.push('群文件为空');
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `获取群文件失败: ${err.message || err}`);
  }
}

async function handleGroupFileInfo(event) {
  if (event.message_type !== 'group') return replyMsg(event, '此指令仅在群聊中可用');
  try {
    const info = await ctx.callApi('get_group_file_system_info', { group_id: event.group_id });
    const formatSize = (bytes) => {
      if (!bytes) return '0B';
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
    };
    const lines = [
      '=== 群文件系统 ===',
      `文件数: ${info.file_count || 0}`,
      `已用空间: ${formatSize(info.used_space)}`,
      `总空间: ${formatSize(info.total_space)}`,
    ];
    await replyMsg(event, lines.join('\n'));
  } catch (err) {
    await replyMsg(event, `获取群文件信息失败: ${err.message || err}`);
  }
}

// ==================== 菜单指令 ====================

async function handleMenu(event) {
  const lines = [
    '=== 示例插件菜单 ===',
    '/ping — 测试 Bot 是否在线',
    '/echo <内容> — 复读消息',
    '/info — 查看 Bot 信息',
    '/time — 当前时间和调用次数',
    '/赞我 — 给你点赞 10 次',
  ];

  const enableCheckin = ctx.getConfig('enableCheckin') ?? false;
  if (enableCheckin) {
    lines.push('/签到 — 每日签到（群聊）');
    lines.push('/签到排行 — 本群签到排行');
  }

  // 信息查询（所有人可用）
  lines.push(
    '',
    '=== 查询 ===',
    '/查群员 @用户 — 查看群成员信息',
    '/查用户 <QQ号> — 查看用户信息',
    '/群荣誉 — 查看群荣誉',
    '/群文件 — 查看群文件列表',
    '/群文件信息 — 查看群文件系统信息',
    '/已读 — 标记消息已读',
  );

  if (isMaster(event.user_id)) {
    // 信息查询（主人）
    lines.push(
      '/群列表 — 查看 Bot 加入的群',
      '/群成员 — 查看本群成员统计',
      '/好友列表 — 查看 Bot 好友列表',
    );

    const enableGroupAdmin = ctx.getConfig('enableGroupAdmin') ?? true;
    if (enableGroupAdmin) {
      lines.push(
        '',
        '=== 群管理 ===',
        '/禁言 @用户 [分钟] — 禁言（默认10分钟）',
        '/解禁 @用户 — 解除禁言',
        '/踢 @用户 — 踢出群聊',
        '/全员禁言 / /解除全员禁言',
        '/群名片 @用户 新名片',
        '/群公告 <内容> — 发布群公告',
        '/改群名 <新群名> — 修改群名',
        '/设管理 @用户 / /取消管理 @用户',
        '/头衔 @用户 <头衔> — 设置专属头衔',
        '/退群 [群号] — 退出群聊',
        '/撤回 — 回复消息后撤回',
        '/群历史 [数量] — 查看历史消息',
      );
    }

    lines.push(
      '',
      '=== 功能管理 ===',
      '/功能列表 — 查看功能开关状态',
      '/开启 <功能名> / /关闭 <功能名>',
    );
  }

  await replyMsg(event, lines.join('\n'));
}

// ==================== 功能开关指令 ====================

async function handleFeatureList(event) {
  if (!isMaster(event.user_id)) {
    return replyMsg(event, '权限不足：仅主人可使用此指令');
  }
  const lines = ['=== 功能开关列表 ==='];
  TOGGLE_FEATURES.forEach(([key, label], i) => {
    const enabled = ctx.getConfig(key);
    const status = enabled ? '✅' : '❌';
    lines.push(`${status} ${i + 1}. ${label}`);
  });
  lines.push('', '使用 /开启 <序号或功能名> 或 /关闭 <序号或功能名> 切换');
  await replyMsg(event, lines.join('\n'));
}

function findFeature(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // 支持按序号查找
  if (/^\d+$/.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx >= 0 && idx < TOGGLE_FEATURES.length) return TOGGLE_FEATURES[idx];
    return null;
  }
  return TOGGLE_FEATURES.find(([, label]) => label === trimmed) || null;
}

async function handleFeatureToggle(event, name, enable) {
  if (!isMaster(event.user_id)) {
    return replyMsg(event, '权限不足：仅主人可使用此指令');
  }
  if (!name) {
    return replyMsg(event, `用法: ${enable ? '/开启' : '/关闭'} <序号或功能名>\n使用 /功能列表 查看所有功能`);
  }
  const feature = findFeature(name);
  if (!feature) {
    return replyMsg(event, `未找到功能「${name}」\n使用 /功能列表 查看所有功能`);
  }
  const [key, label] = feature;
  const current = ctx.getConfig(key);
  if (enable && current) {
    return replyMsg(event, `「${label}」已经是开启状态`);
  }
  if (!enable && !current) {
    return replyMsg(event, `「${label}」已经是关闭状态`);
  }
  ctx.setConfig(key, enable);
  await replyMsg(event, `已${enable ? '开启' : '关闭'}「${label}」`);
}

// ==================== 生命周期 ====================

export default {
  async onLoad(context) {
    ctx = context;
    ctx.logger.info('示例插件已加载');
    const count = readCounter();
    ctx.logger.info(`dataDir 历史调用计数: ${count}`);

    // 加载签到数据
    checkinData = loadCheckinData();
    ctx.logger.info(`签到数据已加载，覆盖 ${Object.keys(checkinData).length} 个群`);

    // 演示托管定时器：使用 ctx.setInterval 创建定时任务
    // 系统会在插件卸载时自动清除，无需手动清理
    ctx.setInterval(() => {
      ctx.logger.debug('示例插件心跳');
    }, 60000);

    // 定时消息检查器 (E10)：每分钟检查一次
    ctx.setInterval(() => {
      const enableScheduledMsg = ctx.getConfig('enableScheduledMsg') ?? false;
      if (!enableScheduledMsg) return;
      try {
        const raw = ctx.getConfig('scheduledMessages') ?? '[]';
        const tasks = JSON.parse(raw);
        if (!Array.isArray(tasks)) return;
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        const hour = now.getHours();
        const minute = now.getMinutes();
        for (const task of tasks) {
          if (task.hour === hour && task.minute === minute && task.group_id && task.message) {
            ctx.sendMessage('group', task.group_id, task.message);
            ctx.logger.info(`定时消息已发送到群 ${task.group_id}`);
          }
        }
      } catch (err) {
        ctx.logger.warn(`定时消息解析失败: ${err.message || err}`);
      }
    }, 60000);
  },

  async onUnload() {
    // onUnload 仅用于自定义清理逻辑（如关闭第三方连接）
    // 托管定时器（ctx.setTimeout/ctx.setInterval）由系统自动清除，无需手动处理
    repeatTracker.clear();
    messageCache.clear();
    if (ctx) {
      ctx.logger.info('示例插件已卸载');
    }
    ctx = null;
  },

  async onMessage(event, connectionId) {
    // 缓存消息用于防撤回（在处理指令之前）
    if (event.message_id) {
      const senderName = event.sender?.card || event.sender?.nickname || String(event.user_id);
      // 存储原始消息段，防撤回时直接转发保留图片/表情等
      const message = Array.isArray(event.message) && event.message.length > 0
        ? event.message
        : (event.raw_message ? [{ type: 'text', data: { text: event.raw_message } }] : null);
      if (message) {
        messageCache.set(event.message_id, {
          sender: senderName,
          userId: event.user_id,
          message,
          time: event.time || Math.floor(Date.now() / 1000),
        });
        if (messageCache.size > MESSAGE_CACHE_MAX) {
          const firstKey = messageCache.keys().next().value;
          messageCache.delete(firstKey);
        }
      }
    }

    const text = event.raw_message?.trim();
    if (!text) return;

    if (text === '/ping') {
      await handlePing(event);
    } else if (text === '/菜单' || text === '/menu') {
      await handleMenu(event);
    } else if (text.startsWith('/echo ')) {
      await handleEcho(event, text.slice(6));
    } else if (text === '/echo') {
      await ctx.sendMessage(event.message_type, getTarget(event),
        '用法: /echo <内容>');
    } else if (text === '/info') {
      await handleInfo(event);
    } else if (text === '/time') {
      await handleTime(event);
    } else if (text === '/赞我' || text === '/赞' || text === '/点赞') {
      await handleLike(event);
    } else if (text === '/签到') {
      const enableCheckin = ctx.getConfig('enableCheckin') ?? false;
      if (enableCheckin) await handleCheckin(event);
    } else if (text === '/签到排行') {
      const enableCheckin = ctx.getConfig('enableCheckin') ?? false;
      if (enableCheckin) await handleCheckinRank(event);
    } else if (text === '/功能列表') {
      await handleFeatureList(event);
    } else if (text.startsWith('/开启 ')) {
      await handleFeatureToggle(event, text.slice(4), true);
    } else if (text.startsWith('/关闭 ')) {
      await handleFeatureToggle(event, text.slice(4), false);
    } else if (text === '/查群员') {
      await handleGetMemberInfo(event);
    } else if (text.startsWith('/查用户 ')) {
      await handleStrangerInfo(event, text.slice(4).trim());
    } else if (text === '/查用户') {
      await replyMsg(event, '用法: /查用户 <QQ号>');
    } else if (text === '/群荣誉') {
      await handleGroupHonor(event);
    } else if (text === '/群文件信息') {
      await handleGroupFileInfo(event);
    } else if (text === '/群文件') {
      await handleGroupFiles(event);
    } else if (text === '/已读') {
      await handleMarkRead(event);
    } else if (text === '/群列表') {
      await handleGroupList(event);
    } else if (text === '/群成员') {
      await handleGroupMemberList(event);
    } else if (text === '/好友列表') {
      await handleFriendList(event);
    } else if (text === '/群历史' || text.startsWith('/群历史 ')) {
      await handleGroupHistory(event, text.slice(4).trim());
    }

    // /撤回 指令（回复消息时 raw_message 包含 CQ 码，用纯文本匹配）
    const pureText = getPureText(event);
    if (pureText === '/撤回') {
      await handleDeleteMsg(event);
    }

    // 群管理指令
    const enableGroupAdmin = ctx.getConfig('enableGroupAdmin') ?? true;
    if (enableGroupAdmin) {
      const [cmd, ...args] = text.split(/\s+/);
      const argStr = args.join(' ').trim();
      switch (cmd) {
        case '/禁言': await handleBan(event, args); break;
        case '/解禁': await handleUnban(event); break;
        case '/踢': await handleKick(event); break;
        case '/全员禁言': await handleWholeBan(event, true); break;
        case '/解除全员禁言': await handleWholeBan(event, false); break;
        case '/群名片': await handleSetCard(event, argStr); break;
        case '/群公告': await handleGroupNotice(event, argStr); break;
        case '/改群名': await handleSetGroupName(event, argStr); break;
        case '/设管理': await handleSetGroupAdmin(event, true); break;
        case '/取消管理': await handleSetGroupAdmin(event, false); break;
        case '/头衔': await handleSetSpecialTitle(event, argStr); break;
        case '/退群': await handleLeaveGroup(event, argStr); break;
      }
    }

    // 复读检测 (E8) — 仅群聊
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
    // 戳一戳回应
    if (event.notice_type === 'notify' && event.sub_type === 'poke') {
      const enablePokeReply = ctx.getConfig('enablePokeReply') ?? true;
      if (enablePokeReply && event.target_id === event.self_id && event.group_id) {
        const reply = randomPokeReply();
        await ctx.sendMessage('group', event.group_id, [
          { type: 'at', data: { qq: String(event.user_id) } },
          { type: 'text', data: { text: ` ${reply}` } },
        ]);
      }
    }

    // 进群欢迎
    if (event.notice_type === 'group_increase' && event.group_id && event.user_id) {
      const enableWelcome = ctx.getConfig('enableWelcome') ?? true;
      if (enableWelcome) {
        const welcomeMsg = ctx.getConfig('welcomeMsg') ?? '欢迎加入！';
        await ctx.sendMessage('group', event.group_id, [
          { type: 'at', data: { qq: String(event.user_id) } },
          { type: 'text', data: { text: ` ${welcomeMsg}` } },
        ]);
      }
    }

    // 防撤回（群聊）
    if (event.notice_type === 'group_recall' && event.group_id) {
      const enableAntiRecall = ctx.getConfig('enableAntiRecall') ?? false;
      if (enableAntiRecall && event.message_id) {
        try {
          const cached = messageCache.get(event.message_id);
          let senderName, messageSegs, sendTime;

          if (cached) {
            senderName = cached.sender;
            messageSegs = cached.message;
            sendTime = new Date(cached.time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            messageCache.delete(event.message_id);
          } else {
            const msgData = await ctx.callApi('get_msg', { message_id: event.message_id });
            senderName = msgData.sender?.nickname || String(event.user_id);
            messageSegs = (Array.isArray(msgData.message) && msgData.message.length > 0)
              ? msgData.message
              : (msgData.raw_message ? [{ type: 'text', data: { text: msgData.raw_message } }] : null);
            sendTime = new Date((msgData.time ?? 0) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          }

          const operatorId = event.operator_id;
          const isSelfRecall = operatorId === event.user_id;
          const recallDesc = isSelfRecall
            ? `${senderName}(${event.user_id}) 撤回了一条消息`
            : `管理员(${operatorId}) 撤回了 ${senderName}(${event.user_id}) 的一条消息`;

          const nodes = [
            {
              type: 'node',
              data: {
                user_id: '10000',
                nickname: '消息内容',
                content: [{ type: 'text', data: { text: `${recallDesc}\n时间: ${sendTime}` } }],
              },
            },
            {
              type: 'node',
              data: {
                user_id: '10000',
                nickname: '消息内容',
                content: messageSegs || [{ type: 'text', data: { text: '(无法获取消息内容)' } }],
              },
            },
          ];

          await ctx.callApi('send_group_forward_msg', {
            group_id: event.group_id,
            messages: nodes,
          });
        } catch (err) {
          ctx.logger.warn(`防撤回处理失败: ${err.message || err}`);
        }
      }
    }

    // 私聊防撤回
    if (event.notice_type === 'friend_recall' && event.user_id) {
      const enableAntiRecall = ctx.getConfig('enableAntiRecall') ?? false;
      if (enableAntiRecall && event.message_id) {
        try {
          const cached = messageCache.get(event.message_id);
          let senderName, messageSegs, sendTime;

          if (cached) {
            senderName = cached.sender;
            messageSegs = cached.message;
            sendTime = new Date(cached.time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            messageCache.delete(event.message_id);
          } else {
            const msgData = await ctx.callApi('get_msg', { message_id: event.message_id });
            senderName = msgData.sender?.nickname || String(event.user_id);
            messageSegs = (Array.isArray(msgData.message) && msgData.message.length > 0)
              ? msgData.message
              : (msgData.raw_message ? [{ type: 'text', data: { text: msgData.raw_message } }] : null);
            sendTime = new Date((msgData.time ?? 0) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          }

          // 先发说明
          await ctx.sendMessage('private', event.user_id,
            `${senderName}(${event.user_id}) 撤回了一条消息\n时间: ${sendTime}\n内容:`);
          // 再转发原始消息（保留图片/表情等）
          if (messageSegs) {
            await ctx.sendMessage('private', event.user_id, messageSegs);
          } else {
            await ctx.sendMessage('private', event.user_id, '(无法获取消息内容)');
          }
        } catch (err) {
          ctx.logger.warn(`私聊防撤回处理失败: ${err.message || err}`);
        }
      }
    }

    // 退群/被踢通知
    if (event.notice_type === 'group_decrease' && event.group_id && event.user_id) {
      const enableLeaveNotice = ctx.getConfig('enableLeaveNotice') ?? true;
      if (enableLeaveNotice) {
        let msg;
        if (event.sub_type === 'kick') {
          const operatorId = event.operator_id;
          msg = `成员 ${event.user_id} 被${operatorId ? ` ${operatorId} ` : ''}移出了群聊`;
        } else {
          msg = `成员 ${event.user_id} 退出了群聊`;
        }
        await ctx.sendMessage('group', event.group_id, msg);
      }
    }

    // 管理员变动通知 (E2)
    if (event.notice_type === 'group_admin' && event.group_id && event.user_id) {
      const enableAdminNotice = ctx.getConfig('enableAdminNotice') ?? true;
      if (enableAdminNotice) {
        const action = event.sub_type === 'set' ? '被设为管理员' : '被取消管理员';
        await ctx.sendMessage('group', event.group_id, `成员 ${event.user_id} ${action}`);
      }
    }

    // 禁言通知 (E3)
    if (event.notice_type === 'group_ban' && event.group_id) {
      const enableBanNotice = ctx.getConfig('enableBanNotice') ?? true;
      if (enableBanNotice) {
        if (event.sub_type === 'ban') {
          const duration = event.duration;
          const minutes = duration ? Math.floor(duration / 60) : 0;
          const durationText = minutes >= 1440
            ? `${Math.floor(minutes / 1440)} 天`
            : minutes >= 60
              ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
              : `${minutes} 分钟`;
          await ctx.sendMessage('group', event.group_id,
            `成员 ${event.user_id} 被 ${event.operator_id || '管理员'} 禁言 ${durationText}`);
        } else if (event.sub_type === 'lift_ban') {
          await ctx.sendMessage('group', event.group_id,
            `成员 ${event.user_id} 被 ${event.operator_id || '管理员'} 解除禁言`);
        }
      }
    }

    // 好友添加欢迎 (E4)
    if (event.notice_type === 'friend_add' && event.user_id) {
      const enableFriendWelcome = ctx.getConfig('enableFriendWelcome') ?? true;
      if (enableFriendWelcome) {
        const welcomeMsg = ctx.getConfig('friendWelcomeMsg') ?? '你好！很高兴认识你~';
        await ctx.sendMessage('private', event.user_id, welcomeMsg);
      }
    }

    // 群文件上传通知 (E5)
    if (event.notice_type === 'group_upload' && event.group_id) {
      const enableFileNotice = ctx.getConfig('enableFileNotice') ?? false;
      if (enableFileNotice) {
        const file = event.file;
        const fileName = file?.name || '未知文件';
        const fileSize = file?.size;
        const sizeText = fileSize
          ? fileSize < 1024 * 1024
            ? `${(fileSize / 1024).toFixed(1)}KB`
            : `${(fileSize / (1024 * 1024)).toFixed(1)}MB`
          : '未知大小';
        await ctx.sendMessage('group', event.group_id,
          `${event.user_id} 上传了文件: ${fileName} (${sizeText})`);
      }
    }

    // 荣誉变更通知 (E6)
    if (event.notice_type === 'notify' && event.sub_type === 'honor' && event.group_id) {
      const enableHonorNotice = ctx.getConfig('enableHonorNotice') ?? true;
      if (enableHonorNotice) {
        const honorMap = {
          talkative: '龙王',
          performer: '群聊之火',
          emotion: '快乐源泉',
        };
        const honorName = honorMap[event.honor_type] || event.honor_type || '未知荣誉';
        await ctx.sendMessage('group', event.group_id,
          `恭喜 ${event.user_id} 获得「${honorName}」荣誉！`);
      }
    }

    // 运气王播报 (E7)
    if (event.notice_type === 'notify' && event.sub_type === 'lucky_king' && event.group_id) {
      const enableLuckyKing = ctx.getConfig('enableLuckyKing') ?? true;
      if (enableLuckyKing) {
        await ctx.sendMessage('group', event.group_id, [
          { type: 'at', data: { qq: String(event.target_id || event.user_id) } },
          { type: 'text', data: { text: ' 是本次的运气王！' } },
        ]);
      }
    }
  },
};
