import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

class UpdateActivityDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time!: string;

  @IsString()
  @Length(1, 200)
  location!: string;

  @IsString()
  @Length(1, 500)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsString()
  weather!: string;

  @IsInt()
  @Min(0)
  orderIndex!: number;
}

class UpdateDayDto {
  @IsDateString()
  date!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateActivityDto)
  activities!: UpdateActivityDto[];
}

/**
 * Update payload requires version for optimistic locking (AR-9 / ER-3).
 */
export class UpdateItineraryDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateDayDto)
  days?: UpdateDayDto[];

  @IsInt()
  @Min(1)
  version!: number;
}

export { UpdateDayDto, UpdateActivityDto };
