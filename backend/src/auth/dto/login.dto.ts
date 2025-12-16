import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Login payload; rejects obviously invalid credentials to minimize unnecessary DB lookups.
 */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
