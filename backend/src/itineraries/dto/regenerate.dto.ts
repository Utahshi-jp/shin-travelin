import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsUUID, Min } from 'class-validator';

/**
 * Partial regeneration target day indexes (FR-5 / AR-10).
 */
export class RegenerateRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @IsInt({ each: true })
  @Min(0, { each: true })
  days!: number[];
}

export class RegenerateDto extends RegenerateRequestDto {
  @IsUUID()
  itineraryId!: string;
}
