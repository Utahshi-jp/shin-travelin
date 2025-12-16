import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DraftsModule } from '../drafts/drafts.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiPipeline } from './ai.pipeline';
import { GeminiProvider } from './providers/gemini.provider';

@Module({
  imports: [PrismaModule, DraftsModule],
  controllers: [AiController],
  providers: [AiService, AiPipeline, GeminiProvider],
  exports: [AiService],
})
export class AiModule {}
