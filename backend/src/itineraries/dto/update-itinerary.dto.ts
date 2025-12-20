import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { DayDto } from './create-itinerary.dto';

/**
 * PATCH is intentionally narrow: only title can change; days require regeneration flow (design docs §5.4).
 */
export class UpdateItineraryDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DayDto)
  days?: DayDto[];
}
