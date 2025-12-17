import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ItinerariesService } from './itineraries.service';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { RegenerateDto, RegenerateRequestDto } from './dto/regenerate.dto';
import { ListItinerariesQueryDto } from './dto/list-itineraries.dto';

@Controller('itineraries')
@UseGuards(JwtAuthGuard)
export class ItinerariesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

  /**
   * Persists generated itinerary after job success (AR-8).
   */
  @Post()
  @HttpCode(HttpStatus.GONE)
  create() {
    return { message: 'Manual itinerary creation has been replaced by automatic persistence.' };
  }

  /**
   * SSR-backed list endpoint with simple pagination (FR-3).
   */
  @Get()
  list(@CurrentUser() user: { id: string }, @Query() query: ListItinerariesQueryDto) {
    return this.itinerariesService.list(user.id, query);
  }

  /**
   * Detail view with ownership guard (FR-4/FR-6 read path).
   */
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.itinerariesService.getById(id, user.id);
  }

  /**
   * Optimistic update; version is mandatory (AR-9 / ER-3).
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateItineraryDto, @CurrentUser() user: { id: string }) {
    return this.itinerariesService.update(id, dto, user.id);
  }

  /**
   * Partial regeneration entry point; blocks when another job is running (FR-5 / AR-10).
   */
  @Post(':id/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  regenerate(
    @Param('id') id: string,
    @Body() body: RegenerateRequestDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    const correlationId = (req as any).correlationId as string | undefined;
    return this.itinerariesService.regenerate(id, { ...body, itineraryId: id }, user.id, correlationId ?? randomUUID());
  }

  /**
   * Read-only DTO for printing (FR-6).
   */
  @Get(':id/print')
  getPrint(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.itinerariesService.getPrint(id, user.id);
  }
}
