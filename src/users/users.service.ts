import { Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    // Check if user already exists
    const existingUser = await this.userModel.findOne({ username: createUserDto.username });
    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(createUserDto.password, salt);

    try {
      const createdUser = new this.userModel({
        username: createUserDto.username,
        password_hash: hashedPassword,
        nickname: createUserDto.nickname,
      });
      const saved = await createdUser.save();
      const userObject = saved.toObject();
      delete userObject.password_hash; // never leak password hash to clients
      return userObject as any;
    } catch (error) {
      // Handle any database errors
      if (error.code === 11000) {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }
  }

  async checkUsername(username: string): Promise<boolean> {
    const user = await this.userModel.findOne({ username }).exec();
    return !!user; // true if exists, false if available
  }

  async findOne(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).exec();
  }
}
