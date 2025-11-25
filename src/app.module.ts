import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RobotsModule } from './robots/robots.module';
import { RosProxyService } from './gateway/ros-proxy.service';

@Module({
  imports: [
    MongooseModule.forRoot('mongodb://localhost:27017/ssu-robot-rcs'),
    RobotsModule,
  ],
  controllers: [],
  providers: [RosProxyService],
})
export class AppModule { }