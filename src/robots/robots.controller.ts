import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
  HttpCode,
  Query,
  Put,
  Res,
  StreamableFile
} from '@nestjs/common';
import { Response } from 'express';
import axios from 'axios';
import { RobotsService } from './robots.service';
import { CreateRobotDto } from './dto/create-robot.dto';
import { UpdateRobotDto } from './dto/update-robot.dto';

@Controller('robots')
export class RobotsController {
  constructor(private readonly robotsService: RobotsService) {}

  @Get()
  async findAll(@Query('type') type?: string, @Query('status') status?: 'online' | 'offline' | 'error') {
    let robots = await this.robotsService.findAll();

    if (type) {
      robots = await this.robotsService.getRobotsByType(type);
    }

    if (status) {
      robots = robots.filter(robot => robot.status === status);
    }

    return {
      success: true,
      data: robots,
      total: robots.length
    };
  }

  @Get('online')
  async getOnlineRobots() {
    const robots = await this.robotsService.getOnlineRobots();
    return {
      success: true,
      data: robots,
      total: robots.length
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const robot = await this.robotsService.findOne(id);
    return {
      success: true,
      data: robot
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createRobotDto: CreateRobotDto) {
    const robot = await this.robotsService.create(createRobotDto);
    return {
      success: true,
      data: robot,
      message: 'Robot created successfully'
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateRobotDto: UpdateRobotDto) {
    const robot = await this.robotsService.update(id, updateRobotDto);
    return {
      success: true,
      data: robot,
      message: 'Robot updated successfully'
    };
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'online' | 'offline' | 'error' }
  ) {
    const robot = await this.robotsService.updateStatus(id, body.status);
    return {
      success: true,
      data: robot,
      message: 'Robot status updated successfully'
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.robotsService.remove(id);
    return {
      success: true,
      message: 'Robot deleted successfully'
    };
  }

  @Get(':id/health')
  async getHealthCheck(@Param('id') id: string) {
    const robot = await this.robotsService.findOne(id);
    const isHealthy = robot.status === 'online' &&
                     (new Date().getTime() - robot.lastSeen.getTime()) < 60000;

    return {
      success: true,
      data: {
        robotId: id,
        healthy: isHealthy,
        status: robot.status,
        lastSeen: robot.lastSeen,
        uptime: isHealthy ? new Date().getTime() - new Date(robot.lastSeen).getTime() : 0
      }
    };
  }

  @Get(':id/camera/test')
  async testCameraUrl(@Param('id') id: string) {
    const robot = await this.robotsService.findOne(id);
    if (!robot) {
      return { success: false, message: 'Robot not found' };
    }
    const cameraUrl = `http://${robot.ipAddress}:8080/stream?topic=/usb_cam/image_raw`;
    return {
      success: true,
      cameraUrl,
      robotIp: robot.ipAddress,
      robotName: robot.name
    };
  }

  @Get(':id/camera')
  async getCameraStream(@Param('id') id: string, @Res() res: Response) {
    const robot = await this.robotsService.findOne(id);

    if (!robot) {
      console.log('Robot not found:', id);
      return res.status(404).json({ success: false, message: 'Robot not found' });
    }

    // web_video_server URL
    const cameraUrl = `http://${robot.ipAddress}:8080/stream?topic=/usb_cam/image_raw`;
    // console.log('Attempting to connect to camera:', cameraUrl); // 로그 제거 - 너무 자주 발생

    try {
      // Use axios with streaming and no timeout
      const response = await axios.get(cameraUrl, {
        responseType: 'stream',
        timeout: 0, // No timeout for streaming
        headers: {
          'Connection': 'keep-alive'
        }
      });

      // console.log('Camera connection successful, streaming...'); // 로그 제거
      // console.log('Original Content-Type:', response.headers['content-type']); // 로그 제거

      // Forward the exact Content-Type from the source (including boundary)
      const contentType = response.headers['content-type'] || 'multipart/x-mixed-replace; boundary=frame';

      // Set headers - use the original content type to preserve boundary
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Connection', 'keep-alive');

      // Handle client disconnect
      res.on('close', () => {
        // console.log('Client disconnected from camera stream'); // 로그 제거
        response.data.destroy();
      });

      // Handle stream errors
      response.data.on('error', (err) => {
        console.error('Stream error:', err.message);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });

      // Pipe the camera stream to the response
      response.data.pipe(res);

    } catch (error) {
      console.error('Camera stream error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
      }
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: 'Failed to connect to camera stream',
          error: error.message,
          cameraUrl
        });
      }
    }
  }
}