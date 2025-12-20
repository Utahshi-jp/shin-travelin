import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DraftsService } from './drafts.service';
import { CreateDraftDto } from './dto/create-draft.dto';

@Controller('drafts')
@UseGuards(JwtAuthGuard)
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  /**
   * Saves Draft + Companion atomically (AR-4).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateDraftDto, @CurrentUser() user: { id: string }) {
    return this.draftsService.create(dto, user.id);
  }

  /**
   * Fetches draft with ownership enforcement (AR-5).
   */
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.draftsService.getById(id, user.id);
  }
}
