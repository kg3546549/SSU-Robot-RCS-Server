import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RobotConnectionService } from '../robots/robot-connection.service';
import { RobotsService } from '../robots/robots.service';

interface JoystickPayload {
  robotId: string;
  x: number;
  y: number;
}

interface MovePayload {
  robotId: string;
  direction: 'forward' | 'backward' | 'left' | 'right';
  speed: number;
}

interface RotatePayload {
  robotId: string;
  direction: 'left' | 'right';
  speed: number;
}

interface StopPayload {
  robotId: string;
}

interface SetModePayload {
  robotId: string;
  mode: number;
  speed?: number;
}

interface ArmControlPayload {
  robotId: string;
  joints: number[];
  id?: number;
  angle?: number;
  runTime: number;
}

interface ConnectRobotPayload {
  robotId: string;
}

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  },
})
export class RobotControlGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RobotControlGateway.name);

  constructor(
    private readonly robotConnectionService: RobotConnectionService,
    private readonly robotsService: RobotsService,
  ) { }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Connect to a robot's ROSBridge
   */
  @SubscribeMessage('robot:connect')
  async handleConnectRobot(
    @MessageBody() payload: ConnectRobotPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const { robotId } = payload;

    try {
      // Get robot info from database
      const robot = await this.robotsService.findOne(robotId);
      if (!robot) {
        client.emit('robot:error', {
          robotId,
          error: 'Robot not found',
        });
        return;
      }

      // Register callback for connection status changes
      this.robotConnectionService.onConnectionStatusChange(robotId, async (status) => {
        if (status === 'disconnected' || status === 'error') {
          this.logger.warn(`Robot ${robotId} connection lost: ${status}`);

          // Update database status
          await this.robotsService.updateStatus(robotId, 'offline');

          // Broadcast to all clients
          this.server.emit('robot:statusChanged', {
            robotId,
            status: 'offline',
            timestamp: new Date().toISOString(),
          });

          this.server.emit('robot:disconnected', {
            robotId,
            reason: status === 'error' ? 'Connection error' : 'Connection closed',
          });
        }
      });

      // Connect to robot
      await this.robotConnectionService.connectToRobot(robotId, robot.ipAddress, robot.port);

      // Subscribe to battery voltage topic
      this.robotConnectionService.subscribeToBatteryVoltage(robotId, async (voltage) => {
        // Broadcast battery voltage to all clients
        this.server.emit('robot:batteryVoltage', {
          robotId,
          voltage,
          timestamp: new Date().toISOString(),
        });

        // Update database with battery voltage
        try {
          await this.robotsService.updateBatteryVoltage(robotId, voltage);
        } catch (error) {
          this.logger.error(`Failed to update battery voltage for robot ${robotId}:`, error);
        }
      });

      // Subscribe to arm angle updates
      this.robotConnectionService.subscribeToArmAngleUpdate(robotId, (angles) => {
        // Broadcast arm angle updates to all clients
        this.server.emit('robot:armAngleUpdate', {
          robotId,
          angles,
          timestamp: new Date().toISOString(),
        });
      });

      // Subscribe to laser scan
      this.robotConnectionService.subscribeToLaserScan(robotId, (scanData) => {
        // Relay scan data to all clients
        this.server.emit('robot:scanData', {
          robotId,
          scan: scanData,
          timestamp: new Date().toISOString(),
        });
      });

      // Subscribe to map
      this.robotConnectionService.subscribeToMap(robotId, (mapData) => {
        // Relay map data to all clients
        this.server.emit('robot:mapData', {
          robotId,
          map: mapData,
          timestamp: new Date().toISOString(),
        });
      });

      // Get current arm angles
      try {
        const currentAngles = await this.robotConnectionService.getCurrentArmAngles(robotId);
        client.emit('robot:currentArmAngles', {
          robotId,
          angles: currentAngles,
        });
      } catch (error) {
        this.logger.warn(`Failed to get current arm angles for robot ${robotId}:`, error);
      }

      client.emit('robot:connected', {
        robotId,
        message: `Connected to robot ${robot.name}`,
      });

      // Update robot status to online
      await this.robotsService.updateStatus(robotId, 'online');

      // Broadcast status change to all clients
      this.server.emit('robot:statusChanged', {
        robotId,
        status: 'online',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Error connecting to robot ${robotId}:`, error);
      client.emit('robot:error', {
        robotId,
        error: error.message,
      });
    }
  }

  /**
   * Disconnect from a robot
   */
  @SubscribeMessage('robot:disconnect')
  async handleDisconnectRobot(
    @MessageBody() payload: ConnectRobotPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const { robotId } = payload;

    try {
      this.robotConnectionService.disconnectFromRobot(robotId);
      client.emit('robot:disconnected', { robotId });

      // Update robot status to offline
      await this.robotsService.updateStatus(robotId, 'offline');
    } catch (error) {
      this.logger.error(`Error disconnecting from robot ${robotId}:`, error);
    }
  }

  /**
   * Handle joystick movement
   */
  @SubscribeMessage('robot:joystick')
  handleJoystick(@MessageBody() payload: JoystickPayload) {
    const { robotId, x, y } = payload;

    if (!this.robotConnectionService.isRobotConnected(robotId)) {
      this.server.emit('robot:error', {
        robotId,
        error: 'Robot not connected',
      });
      return;
    }

    const MAX_LINEAR_SPEED = 1.0;

    const twist = {
      linear: { x: y * MAX_LINEAR_SPEED, y: -x * MAX_LINEAR_SPEED, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    };

    this.robotConnectionService.publishCmdVel(robotId, twist.linear, twist.angular);

    this.server.emit('robot:log', {
      robotId,
      message: `Joystick: x=${x.toFixed(2)}, y=${y.toFixed(2)}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle directional movement
   */
  @SubscribeMessage('robot:move')
  handleMove(@MessageBody() payload: MovePayload) {
    const { robotId, direction, speed } = payload;

    if (!this.robotConnectionService.isRobotConnected(robotId)) {
      this.server.emit('robot:error', {
        robotId,
        error: 'Robot not connected',
      });
      return;
    }

    let linear = { x: 0, y: 0, z: 0 };

    switch (direction) {
      case 'forward':
        linear.x = speed;
        break;
      case 'backward':
        linear.x = -speed;
        break;
      case 'left':
        linear.y = speed;
        break;
      case 'right':
        linear.y = -speed;
        break;
    }

    this.robotConnectionService.publishCmdVel(
      robotId,
      linear,
      { x: 0, y: 0, z: 0 },
    );

    this.server.emit('robot:log', {
      robotId,
      message: `Moving ${direction} at speed ${speed}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle rotation
   */
  @SubscribeMessage('robot:rotate')
  handleRotate(@MessageBody() payload: RotatePayload) {
    const { robotId, direction, speed } = payload;

    if (!this.robotConnectionService.isRobotConnected(robotId)) {
      this.server.emit('robot:error', {
        robotId,
        error: 'Robot not connected',
      });
      return;
    }

    const angular = {
      x: 0,
      y: 0,
      z: direction === 'left' ? speed : -speed,
    };

    this.robotConnectionService.publishCmdVel(
      robotId,
      { x: 0, y: 0, z: 0 },
      angular,
    );

    this.server.emit('robot:log', {
      robotId,
      message: `Rotating ${direction} at speed ${speed}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle stop command
   */
  @SubscribeMessage('robot:stop')
  handleStop(@MessageBody() payload: StopPayload) {
    const { robotId } = payload;

    if (!this.robotConnectionService.isRobotConnected(robotId)) {
      this.server.emit('robot:error', {
        robotId,
        error: 'Robot not connected',
      });
      return;
    }

    this.robotConnectionService.publishCmdVel(
      robotId,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    );

    this.server.emit('robot:log', {
      robotId,
      message: 'Robot stopped',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle emergency stop
   */
  @SubscribeMessage('robot:emergency')
  handleEmergency(@MessageBody() payload: StopPayload) {
    const { robotId } = payload;

    if (!this.robotConnectionService.isRobotConnected(robotId)) {
      this.server.emit('robot:error', {
        robotId,
        error: 'Robot not connected',
      });
      return;
    }

    this.robotConnectionService.publishCmdVel(
      robotId,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    );

    this.server.emit('robot:log', {
      robotId,
      message: '🚨 EMERGENCY STOP ACTIVATED!',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle mode change
   */
  @SubscribeMessage('robot:setMode')
  async handleSetMode(
    @MessageBody() payload: SetModePayload,
    @ConnectedSocket() client: Socket,
  ) {
    const { robotId, mode, speed = 0.5 } = payload;

    if (!this.robotConnectionService.isRobotConnected(robotId)) {
      client.emit('robot:error', {
        robotId,
        error: 'Robot not connected',
      });
      return;
    }

    try {
      const response = await this.robotConnectionService.callModeService(
        robotId,
        'set',
        { mode, speed },
      );

      client.emit('robot:modeChanged', {
        robotId,
        currentMode: response.current_mode,
        modeName: response.mode_name,
      });

      this.server.emit('robot:log', {
        robotId,
        message: `Mode changed to: ${response.mode_name}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Error setting mode for robot ${robotId}:`, error);
      client.emit('robot:error', {
        robotId,
        error: error.message,
      });
    }
  }

  /**
   * Get current mode
   */
  @SubscribeMessage('robot:getMode')
  async handleGetMode(
    @MessageBody() payload: { robotId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { robotId } = payload;

    if (!this.robotConnectionService.isRobotConnected(robotId)) {
      client.emit('robot:error', {
        robotId,
        error: 'Robot not connected',
      });
      return;
    }

    try {
      const response = await this.robotConnectionService.callModeService(
        robotId,
        'get',
      );

      client.emit('robot:modeChanged', {
        robotId,
        currentMode: response.current_mode,
        modeName: response.mode_name,
      });
    } catch (error) {
      this.logger.error(`Error getting mode for robot ${robotId}:`, error);
      client.emit('robot:error', {
        robotId,
        error: error.message,
      });
    }
  }

  @SubscribeMessage('robot:armControl')
  handleArmControl(@MessageBody() payload: ArmControlPayload) {
    const { robotId, joints, id, angle, runTime } = payload;

    if (!this.robotConnectionService.isRobotConnected(robotId)) {
      this.server.emit('robot:error', {
        robotId,
        error: 'Robot not connected',
      });
      return;
    }

    try {
      // 전체 관절 제어 또는 개별 서보 제어
      if (joints && joints.length === 6) {
        // 전체 관절 제어
        this.robotConnectionService.publishArmControl(robotId, {
          id: 0,
          runTime,
          angle: 0.0,
          joints,
        });

        this.server.emit('robot:log', {
          robotId,
          message: `Arm control: all joints [${joints.join(', ')}], time=${runTime}ms`,
          timestamp: new Date().toISOString(),
        });
      } else if (id !== undefined && angle !== undefined) {
        // 개별 서보 제어
        this.robotConnectionService.publishArmControl(robotId, {
          id,
          runTime,
          angle,
          joints: [],
        });

        this.server.emit('robot:log', {
          robotId,
          message: `Arm control: servo ${id} to ${angle}°, time=${runTime}ms`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      this.logger.error(`Error controlling arm for robot ${robotId}:`, error);
      this.server.emit('robot:error', {
        robotId,
        error: error.message,
      });
    }
  }
}
