import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class CompanionsDto {
  @IsInt()
  @Min(0)
  @Max(20)
  adultMale!: number;

  @IsInt()
  @Min(0)
  @Max(20)
  adultFemale!: number;

  @IsInt()
  @Min(0)
  @Max(20)
  boy!: number;

  @IsInt()
  @Min(0)
  @Max(20)
  girl!: number;

  @IsInt()
  @Min(0)
  @Max(20)
  infant!: number;

  @IsInt()
  @Min(0)
  @Max(20)
  pet!: number;

  @IsInt()
  @Min(0)
  @Max(20)
  other!: number;
}

/**
 * Draft input mirrors FR-1 constraints so invalid itineraries never reach generation.
 */
export class CreateDraftDto {
  @IsString()
  @Length(3, 200)
  origin!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Length(3, 200, { each: true })
  destinations!: string[];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsInt()
  @Min(5000)
  @Max(5000000)
  budget!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  purposes!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;

  @ValidateNested()
  @Type(() => CompanionsDto)
  @IsDefined()
  companions!: CompanionsDto;
}
