import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ActivityCategoryValue {
  FOOD = 'FOOD',
  SIGHTSEEING = 'SIGHTSEEING',
  MOVE = 'MOVE',
  REST = 'REST',
  STAY = 'STAY',
  SHOPPING = 'SHOPPING',
  OTHER = 'OTHER',
}

export enum DayScenarioValue {
  SUNNY = 'SUNNY',
  RAINY = 'RAINY',
}

class ActivityDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be HH:mm' })
  time!: string;

  @IsString()
  @Length(1, 200)
  area!: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  placeName?: string;

  @IsEnum(ActivityCategoryValue)
  category!: ActivityCategoryValue;

  @IsString()
  @Length(1, 500)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  stayMinutes?: number;

  @IsString()
  @Length(3, 20)
  weather!: string;

  @IsInt()
  @Min(0)
  orderIndex!: number;
}

class DayDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dayIndex!: number;

  @IsDateString()
  date!: string;

  @IsEnum(DayScenarioValue)
  scenario!: DayScenarioValue;

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
