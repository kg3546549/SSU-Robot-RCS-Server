import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RobotsService } from './robots.service';
import { RobotsController } from './robots.controller';
import { RobotConnectionService } from './robot-connection.service';
import { Robot as RobotSchema, RobotSchema as RobotSchemaDefinition } from './schemas/robot.schema';
import { RobotControlGateway } from '../gateway/robot-control.gateway';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RobotSchema.name, schema: RobotSchemaDefinition }])
  ],
  controllers: [RobotsController],
  providers: [RobotsService, RobotConnectionService, RobotControlGateway],
  exports: [RobotsService, RobotConnectionService],
})
export class RobotsModule {}