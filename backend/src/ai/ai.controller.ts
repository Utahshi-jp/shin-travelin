import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards, Req } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { GenerateDto } from './dto/generate.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Starts generation job; concurrent jobs for same draft are rejected with 409 (AR-6, ER-3).
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  generate(@Body() dto: GenerateDto, @CurrentUser() user: { id: string }, @Req() req: Request) {
    const correlationId = (req as any).correlationId as string | undefined;
    return this.aiService.enqueue(dto, user.id, correlationId ?? randomUUID());
  }

  /**
   * Returns job status + retryCount + partialDays (AR-7).
   */
  @Get('jobs/:id')
  @HttpCode(HttpStatus.OK)
  getStatus(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.aiService.getStatus(id, user.id);
  }
}
