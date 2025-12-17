import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * Query contract for GET /itineraries, enabling FR-3 search filters.
 */
export class ListItinerariesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  keyword?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  purpose?: string;
}
