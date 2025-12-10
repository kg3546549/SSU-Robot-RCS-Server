import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RobotsModule } from './robots/robots.module';
import { RosProxyService } from './gateway/ros-proxy.service';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI') || 'mongodb://localhost:27017/ssu-robot-rcs',
      }),
      inject: [ConfigService],
    }),
    RobotsModule,
    AuthModule,
  ],
  controllers: [],
  providers: [RosProxyService],
})
export class AppModule { }