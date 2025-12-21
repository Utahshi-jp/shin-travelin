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
 * Partial regeneration target day indexes (FR-5 / AR-10).
 */
export class RegenerateRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @IsInt({ each: true })
  @Min(0, { each: true })
  days!: number[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Length(3, 200, { each: true })
  destinations?: string[];
}

export class RegenerateDto extends RegenerateRequestDto {
  @IsUUID()
  itineraryId!: string;
}
