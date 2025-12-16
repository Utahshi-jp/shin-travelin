import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DraftsModule } from '../drafts/drafts.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiPipeline } from './ai.pipeline';

@Module({
  imports: [PrismaModule, DraftsModule],
  controllers: [AiController],
  providers: [AiService, AiPipeline],
  exports: [AiService],
})
export class AiModule {}
