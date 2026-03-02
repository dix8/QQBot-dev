import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { hashPassword, verifyPassword } from './password.js';
import { nowISO } from '../utils/date.js';

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';

export class AuthService {
  /**
   * Seed the default admin account if no users exist.
   */
  async seedDefaultAdmin(): Promise<void> {
    const existing = db.select().from(schema.users).all();
    if (existing.length > 0) return;

    const hash = await hashPassword(DEFAULT_PASSWORD);
    db.insert(schema.users).values({
      username: DEFAULT_USERNAME,
      passwordHash: hash,
      isDefaultPwd: 1,
    }).run();
  }

  /**
   * Validate login credentials. Returns user info or null on failure.
   */
  async validateLogin(username: string, password: string): Promise<{ id: number; username: string } | null> {
    const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    if (!user) return null;

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return null;

    return { id: user.id, username: user.username };
  }

  /**
   * Change password for a user. Returns true on success, false if current password is wrong.
   */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) return false;

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) return false;

    const newHash = await hashPassword(newPassword);
    db.update(schema.users)
      .set({ passwordHash: newHash, isDefaultPwd: 0, updatedAt: nowISO() })
      .where(eq(schema.users.id, userId))
      .run();

    return true;
  }

  /**
   * Change username for a user. Returns true on success.
   */
  changeUsername(userId: number, newUsername: string): boolean {
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) return false;

    // Check if username is already taken
    const existing = db.select().from(schema.users).where(eq(schema.users.username, newUsername)).get();
    if (existing && existing.id !== userId) return false;

    db.update(schema.users)
      .set({ username: newUsername, updatedAt: nowISO() })
      .where(eq(schema.users.id, userId))
      .run();

    return true;
  }

  /**
   * Check if a user is still using the default password (fast DB lookup, no scrypt).
   */
  isDefaultPassword(userId: number): boolean {
    const user = db.select({ isDefaultPwd: schema.users.isDefaultPwd }).from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) return false;
    return user.isDefaultPwd === 1;
  }
}

export const authService = new AuthService();
