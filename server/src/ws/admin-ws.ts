import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';

interface AdminClient {
  socket: WebSocket;
  alive: boolean;
}

export class AdminWsManager {
  private clients = new Set<AdminClient>();
  private logger: FastifyBaseLogger;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  register(fastify: FastifyInstance): void {
    fastify.get('/ws/admin', { websocket: true }, (socket, request) => {
      const token = (request.query as Record<string, string>).token;
      if (!token) {
        socket.close(4001, 'Missing token');
        return;
      }

      try {
        fastify.jwt.verify(token);
      } catch {
        socket.close(4003, 'Invalid token');
        return;
      }

      const client: AdminClient = { socket, alive: true };
      this.clients.add(client);
      this.logger.info(`Admin WS client connected (total: ${this.clients.size})`);

      socket.on('pong', () => {
        client.alive = true;
      });

      socket.on('close', () => {
        this.clients.delete(client);
        this.logger.info(`Admin WS client disconnected (total: ${this.clients.size})`);
      });

      socket.on('error', () => {
        this.clients.delete(client);
      });
    });

    this.pingTimer = setInterval(() => {
      const dead: AdminClient[] = [];
      for (const client of this.clients) {
        if (!client.alive) {
          dead.push(client);
          continue;
        }
        client.alive = false;
        client.socket.ping();
      }
      for (const client of dead) {
        client.socket.terminate();
        this.clients.delete(client);
      }
    }, 30_000);
  }

  broadcast(event: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify({ event, data });
    for (const client of this.clients) {
      if (client.socket.readyState === 1) {
        client.socket.send(payload);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const client of this.clients) {
      client.socket.close(1001, 'Server shutting down');
    }
    this.clients.clear();
  }
}
