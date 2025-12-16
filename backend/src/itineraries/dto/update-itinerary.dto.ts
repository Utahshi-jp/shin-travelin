import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

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
}
