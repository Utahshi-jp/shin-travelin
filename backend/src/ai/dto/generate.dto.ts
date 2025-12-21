import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

/**
 * AI generation request; targetDays limits regeneration scope (AI-3).
 */
export class GenerateDto {
  @IsUUID()
  draftId!: string;

  @IsOptional()
  @IsUUID()
  itineraryId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @IsInt({ each: true })
  @Min(0, { each: true })
  targetDays?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Length(3, 200, { each: true })
  overrideDestinations?: string[];
}
