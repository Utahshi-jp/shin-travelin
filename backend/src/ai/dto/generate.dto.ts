import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * AI generation request; targetDays limits regeneration scope (AI-3).
 */
export class GenerateDto {
  @IsUUID()
  draftId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @IsInt({ each: true })
  @Min(0, { each: true })
  targetDays?: number[];
}
