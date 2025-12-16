import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

class ActivityDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be HH:mm' })
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
  @Length(3, 20)
  weather!: string;

  @IsInt()
  @Min(0)
  orderIndex!: number;
}

class DayDto {
  @IsDateString()
  date!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityDto)
  activities!: ActivityDto[];
}

/**
 * Itinerary creation payload; validated to avoid invalid persisted state (AR-8, AI-1).
 */
export class CreateItineraryDto {
  @IsUUID()
  draftId!: string;

  @IsUUID()
  jobId!: string;

  @IsString()
  @Length(1, 120)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DayDto)
  days!: DayDto[];

  @IsOptional()
  rawJson?: unknown;
}

export { ActivityDto, DayDto };
