// ==================== Config Types ====================

export interface BasicConfig {
  nickname: string;
  masterQQ: number[];
  autoReply: boolean;
  messageScope: 'private' | 'group' | 'both';
  selfCommandEnabled: boolean;
}

export interface KeywordRule {
  id: string;
  keyword: string;
  reply: string;
  matchType: 'exact' | 'contains' | 'regex';
  enabled: boolean;
}

export interface MessageConfig {
  keywordRules: KeywordRule[];
}

export interface OnlineTime {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

export interface RateLimit {
  enabled: boolean;
  maxMessages: number;
  windowSeconds: number;
}

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
}

export interface RuntimeConfig {
  onlineTime: OnlineTime;
  rateLimit: RateLimit;
  retry: RetryConfig;
}

export interface BotConfigData {
  basic: BasicConfig;
  message: MessageConfig;
  runtime: RuntimeConfig;
}

export type ConfigSection = 'basic' | 'message' | 'runtime';

export const DEFAULT_CONFIG: BotConfigData = {
  basic: {
    nickname: 'QQBot',
    masterQQ: [],
    autoReply: true,
    messageScope: 'both',
    selfCommandEnabled: false,
  },
  message: {
    keywordRules: [],
  },
  runtime: {
    onlineTime: { enabled: false, startHour: 8, endHour: 22 },
    rateLimit: { enabled: false, maxMessages: 20, windowSeconds: 60 },
    retry: { enabled: true, maxRetries: 3, retryDelayMs: 1000 },
  },
};
