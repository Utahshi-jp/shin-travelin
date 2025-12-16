import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CorrelationIdMiddleware } from './shared/correlation.middleware';
import { AuthModule } from './auth/auth.module';
import { DraftsModule } from './drafts/drafts.module';
import { AiModule } from './ai/ai.module';
import { ItinerariesModule } from './itineraries/itineraries.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, DraftsModule, AiModule, ItinerariesModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
