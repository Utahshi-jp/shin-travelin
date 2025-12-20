import { Injectable } from '@nestjs/common';
import { PrismaService } from './../prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async health() {
    // Keep health endpoint lightweight; a simple DB ping avoids scanning large tables.
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      // Degrade gracefully so uptime checks do not explode the app.
      return { status: 'degraded' };
    }
  }
}
