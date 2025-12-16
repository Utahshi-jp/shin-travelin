import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { ItinerariesService } from './itineraries.service';
import { ItinerariesController } from './itineraries.controller';

@Module({
  imports: [PrismaModule, AiModule],
  providers: [ItinerariesService],
  controllers: [ItinerariesController],
})
export class ItinerariesModule {}
