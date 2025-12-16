import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Partial regeneration target day indexes (FR-5 / AR-10).
 */
export class RegenerateDto {
  @IsUUID()
  itineraryId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  days!: number[];
}
