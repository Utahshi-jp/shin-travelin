import { Injectable } from '@nestjs/common';
import { PrismaService } from './../prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async health() {
    const tripCount = await this.prisma.trip.count();
    return { status: 'ok', tripCount };
  }
}
