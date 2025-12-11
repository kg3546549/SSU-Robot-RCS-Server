import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from 'src/users/dto/create-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findOne(username);
    if (user && (await bcrypt.compare(pass, user.password_hash))) {
      // Convert Mongoose document to plain object
      const { password_hash, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = {
      username: user.username,
      nickname: user.nickname || user.username, // Fallback to username if nickname doesn't exist
      sub: user._id?.toString() || user._id,
      // Add issued at timestamp for better security
      iat: Math.floor(Date.now() / 1000),
    };
    return {
      accessToken: this.jwtService.sign(payload),
      expiresIn: '1h', // Inform client of expiration
    };
  }

  async checkUsername(username: string): Promise<boolean> {
    return this.usersService.checkUsername(username);
  }

  async register(createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}
