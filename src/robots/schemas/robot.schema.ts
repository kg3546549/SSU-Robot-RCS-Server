import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';

export type RobotDocument = Robot & Document;

@Schema({ collection: 'robots', timestamps: true })
export class RobotCapability {
  @Prop({ required: true })
  name: string;

  @Prop({
    required: true,
    enum: ['movement', 'sensor', 'camera', 'arm', 'gripper', 'custom']
  })
  type: string;

  @Prop({ required: true, default: true })
  enabled: boolean;

  @Prop({ type: Object, default: {} })
  parameters?: Record<string, any>;
}

const RobotCapabilitySchema = SchemaFactory.createForClass(RobotCapability);

@Schema({ collection: 'robots', timestamps: true })
export class Robot {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  ipAddress: string;

  @Prop({ required: true })
  port: number;

  @Prop({
    required: true,
    enum: ['online', 'offline', 'error'],
    default: 'offline'
  })
  status: string;

  @Prop()
  description?: string;

  @Prop({ default: Date.now })
  lastSeen: Date;

  @Prop({ type: [RobotCapabilitySchema], default: [] })
  capabilities: RobotCapability[];

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: Number, default: 0 })
  batteryVoltage?: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false })
  owner?: mongoose.Types.ObjectId;
}

export const RobotSchema = SchemaFactory.createForClass(Robot);