import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Registration payload with explicit bounds so invalid accounts are rejected early (detail-design.md 3.1).
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName!: string;
}
