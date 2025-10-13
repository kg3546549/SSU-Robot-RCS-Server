import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Robot } from './entities/robot.entity';
import { Robot as RobotSchema, RobotDocument } from './schemas/robot.schema';
import { CreateRobotDto } from './dto/create-robot.dto';
import { UpdateRobotDto } from './dto/update-robot.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RobotsService {
  private sampleRobots: Robot[] = [
    {
      id: '1',
      name: 'Industrial Robot #1',
      type: 'Industrial Arm',
      ipAddress: '192.168.1.100',
      port: 8080,
      status: 'online',
      description: 'Main assembly line robot',
      lastSeen: new Date(),
      capabilities: [
        {
          name: 'Movement',
          type: 'movement',
          enabled: true,
          parameters: { maxSpeed: 100, accuracy: 0.1 }
        },
        {
          name: 'Camera',
          type: 'camera',
          enabled: true,
          parameters: { resolution: '1920x1080', fps: 30 }
        }
      ],
      metadata: { manufacturer: 'RoboCorp', model: 'RC-3000' }
    },
    {
      id: '2',
      name: 'Mobile Robot #2',
      type: 'Mobile Base',
      ipAddress: '192.168.1.101',
      port: 8080,
      status: 'offline',
      description: 'Warehouse navigation robot',
      lastSeen: new Date(Date.now() - 30000),
      capabilities: [
        {
          name: 'Navigation',
          type: 'movement',
          enabled: true,
          parameters: { maxSpeed: 50, autonomousMode: true }
        },
        {
          name: 'Lidar',
          type: 'sensor',
          enabled: true,
          parameters: { range: 100, resolution: 0.1 }
        }
      ],
      metadata: { manufacturer: 'MobileBot Inc', model: 'MB-200' }
    }
  ];

  constructor(
    @InjectModel(RobotSchema.name) private robotModel: Model<RobotDocument>,
  ) {
    this.initializeSampleData();
  }

  private async initializeSampleData() {
    const count = await this.robotModel.countDocuments();
    if (count === 0) {
      await this.robotModel.insertMany(this.sampleRobots);
    }
  }

  async findAll(): Promise<Robot[]> {
    const robots = await this.robotModel.find().exec();
    return robots.map(robot => robot.toObject() as Robot);
  }

  async findOne(id: string): Promise<Robot> {
    const robot = await this.robotModel.findOne({ id }).exec();
    if (!robot) {
      throw new NotFoundException(`Robot with ID ${id} not found`);
    }
    return robot.toObject() as Robot;
  }

  async create(createRobotDto: CreateRobotDto): Promise<Robot> {
    const newRobot = new this.robotModel({
      id: uuidv4(),
      ...createRobotDto,
      status: 'offline',
      lastSeen: new Date(),
      capabilities: createRobotDto.capabilities || [],
      metadata: createRobotDto.metadata || {}
    });

    const savedRobot = await newRobot.save();
    return savedRobot.toObject() as Robot;
  }

  async update(id: string, updateRobotDto: UpdateRobotDto): Promise<Robot> {
    const updatedRobot = await this.robotModel
      .findOneAndUpdate(
        { id },
        { ...updateRobotDto, lastSeen: new Date() },
        { new: true }
      )
      .exec();

    if (!updatedRobot) {
      throw new NotFoundException(`Robot with ID ${id} not found`);
    }

    return updatedRobot.toObject() as Robot;
  }

  async remove(id: string): Promise<void> {
    const result = await this.robotModel.deleteOne({ id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Robot with ID ${id} not found`);
    }
  }

  async updateStatus(id: string, status: 'online' | 'offline' | 'error'): Promise<Robot> {
    const updatedRobot = await this.robotModel
      .findOneAndUpdate(
        { id },
        { status, lastSeen: new Date() },
        { new: true }
      )
      .exec();

    if (!updatedRobot) {
      throw new NotFoundException(`Robot with ID ${id} not found`);
    }

    return updatedRobot.toObject() as Robot;
  }

  async getOnlineRobots(): Promise<Robot[]> {
    const robots = await this.robotModel.find({ status: 'online' }).exec();
    return robots.map(robot => robot.toObject() as Robot);
  }

  async getRobotsByType(type: string): Promise<Robot[]> {
    const robots = await this.robotModel
      .find({ type: { $regex: type, $options: 'i' } })
      .exec();
    return robots.map(robot => robot.toObject() as Robot);
  }

  async updateBatteryVoltage(id: string, voltage: number): Promise<Robot> {
    const updatedRobot = await this.robotModel
      .findOneAndUpdate(
        { id },
        { batteryVoltage: voltage, lastSeen: new Date() },
        { new: true }
      )
      .exec();

    if (!updatedRobot) {
      throw new NotFoundException(`Robot with ID ${id} not found`);
    }

    return updatedRobot.toObject() as Robot;
  }
}