import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import { CreateDraftDto } from './dto/create-draft.dto';

/**
 * DraftsService enforces single-transaction save for Draft + Companion per AR-4.
 */
@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDraftDto, userId: string) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (start > end) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'startDate must be <= endDate',
      });
    }

    const draft = await this.prisma.$transaction(async (tx) => {
      const created = await tx.draft.create({
        data: {
          userId,
          origin: dto.origin,
          destinations: dto.destinations,
          startDate: start,
          endDate: end,
          budget: dto.budget,
          purposes: dto.purposes,
          memo: dto.memo,
        },
      });

      await tx.companionDetail.create({
        data: {
          draftId: created.id,
          adultMale: dto.companions.adultMale,
          adultFemale: dto.companions.adultFemale,
          boy: dto.companions.boy,
          girl: dto.companions.girl,
          infant: dto.companions.infant,
          pet: dto.companions.pet,
          other: dto.companions.other,
        },
      });

      return created;
    });

    return { id: draft.id, createdAt: draft.createdAt };
  }

  async getById(id: string, userId: string) {
    const draft = await this.prisma.draft.findUnique({
      include: { companionDetail: true },
      where: { id },
    });
    if (!draft) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Draft not found',
      });
    }
    if (draft.userId !== userId) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Forbidden',
      });
    }
    return draft;
  }
}
