/**
 * In-memory message statistics tracker.
 * Tracks received/sent messages per hour, per group, per user.
 * Data resets on restart — designed for real-time dashboard monitoring.
 */

export interface HourlyBucket {
  /** Hour key: "YYYY-MM-DD HH" */
  hour: string;
  received: number;
  sent: number;
}

export interface RankedEntry {
  id: number;
  count: number;
}

export interface StatsSnapshot {
  /** Hourly message trend (last 24 hours) */
  hourly: HourlyBucket[];
  /** Top active groups by received message count */
  topGroups: RankedEntry[];
  /** Top active users by received message count */
  topUsers: RankedEntry[];
  /** Total received since startup */
  totalReceived: number;
  /** Total sent since startup */
  totalSent: number;
}

class StatsService {
  /** hour key -> { received, sent } */
  private hourly = new Map<string, { received: number; sent: number }>();
  /** group_id -> count */
  private groupCounts = new Map<number, number>();
  /** user_id -> count */
  private userCounts = new Map<number, number>();

  private totalReceived = 0;
  private totalSent = 0;

  private getCurrentHourKey(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}`;
  }

  private getOrCreateHourBucket(key: string) {
    let bucket = this.hourly.get(key);
    if (!bucket) {
      bucket = { received: 0, sent: 0 };
      this.hourly.set(key, bucket);
    }
    return bucket;
  }

  /** Call when a message event is received */
  recordReceived(groupId?: number, userId?: number): void {
    this.totalReceived++;
    const bucket = this.getOrCreateHourBucket(this.getCurrentHourKey());
    bucket.received++;

    if (groupId) {
      this.groupCounts.set(groupId, (this.groupCounts.get(groupId) ?? 0) + 1);
    }
    if (userId) {
      this.userCounts.set(userId, (this.userCounts.get(userId) ?? 0) + 1);
    }
  }

  /** Call when a message is sent by the bot */
  recordSent(): void {
    this.totalSent++;
    const bucket = this.getOrCreateHourBucket(this.getCurrentHourKey());
    bucket.sent++;
  }

  /** Get stats snapshot for dashboard */
  getSnapshot(topN = 10): StatsSnapshot {
    // Collect last 24 hours of hourly buckets
    const now = new Date();
    const hourly: HourlyBucket[] = [];
    for (let i = 23; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 3600_000);
      const y = t.getFullYear();
      const m = String(t.getMonth() + 1).padStart(2, '0');
      const d = String(t.getDate()).padStart(2, '0');
      const h = String(t.getHours()).padStart(2, '0');
      const key = `${y}-${m}-${d} ${h}`;
      const bucket = this.hourly.get(key);
      hourly.push({
        hour: `${h}:00`,
        received: bucket?.received ?? 0,
        sent: bucket?.sent ?? 0,
      });
    }

    // Prune old hourly entries (keep only last 48 hours)
    const cutoff = new Date(now.getTime() - 48 * 3600_000);
    for (const key of this.hourly.keys()) {
      // key format: "YYYY-MM-DD HH"
      const d = new Date(key.replace(' ', 'T') + ':00:00');
      if (d < cutoff) this.hourly.delete(key);
    }

    // Top groups
    const topGroups = [...this.groupCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([id, count]) => ({ id, count }));

    // Top users
    const topUsers = [...this.userCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([id, count]) => ({ id, count }));

    return {
      hourly,
      topGroups,
      topUsers,
      totalReceived: this.totalReceived,
      totalSent: this.totalSent,
    };
  }
}

export const statsService = new StatsService();
