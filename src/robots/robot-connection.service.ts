import { Injectable, Logger } from '@nestjs/common';
import * as ROSLIB from 'roslib';

interface RobotConnection {
  ros: ROSLIB.Ros;
  topics: Map<string, ROSLIB.Topic>;
  isConnected: boolean;
  lastSeen: Date;
  batteryVoltage?: number;
}

@Injectable()
export class RobotConnectionService {
  private readonly logger = new Logger(RobotConnectionService.name);
  private connections = new Map<string, RobotConnection>();
  private connectionCallbacks = new Map<string, (status: 'connected' | 'disconnected' | 'error') => void>();

  /**
   * Register callback for connection status changes
   */
  onConnectionStatusChange(robotId: string, callback: (status: 'connected' | 'disconnected' | 'error') => void) {
    this.connectionCallbacks.set(robotId, callback);
  }

  /**
   * Connect to a robot's ROSBridge
   */
  async connectToRobot(robotId: string, ip: string, port: number): Promise<void> {
    // If already connected to this robot, do nothing
    if (this.connections.has(robotId)) {
      this.logger.log(`[RobotConnection] Already connected to robot ${robotId}`);
      return;
    }

    const rosUrl = `ws://${ip}:${port}`;
    this.logger.log(`[RobotConnection] Initiating ROS connection to ${rosUrl} for robot ${robotId}`);

    return new Promise((resolve, reject) => {
      const ros = new ROSLIB.Ros({ url: rosUrl });

      ros.on('connection', () => {
        this.logger.log(`[RobotConnection] Connected to ROS bridge at ${rosUrl}`);

        const connection: RobotConnection = {
          ros,
          topics: new Map(),
          isConnected: true,
          lastSeen: new Date(),
        };

        this.connections.set(robotId, connection);

        // Notify callback
        const callback = this.connectionCallbacks.get(robotId);
        if (callback) callback('connected');

        resolve();
      });

      ros.on('error', (error) => {
        this.logger.error(`[RobotConnection] Error connecting to ROS bridge at ${rosUrl}:`, error);

        // Notify callback
        const callback = this.connectionCallbacks.get(robotId);
        if (callback) callback('error');

        // Only reject if we haven't successfully connected yet
        if (!this.connections.has(robotId)) {
          reject(error);
        }
      });

      ros.on('close', () => {
        this.logger.log(`[RobotConnection] Connection to ROS bridge at ${rosUrl} closed`);

        const connection = this.connections.get(robotId);
        if (connection) {
          connection.isConnected = false;
        }

        // Notify callback
        const callback = this.connectionCallbacks.get(robotId);
        if (callback) callback('disconnected');

        this.connections.delete(robotId);
      });
    });
  }

  /**
   * Disconnect from a robot
   */
  disconnectFromRobot(robotId: string): void {
    const connection = this.connections.get(robotId);
    if (connection) {
      connection.ros.close();
      this.connections.delete(robotId);
      this.logger.log(`Disconnected from robot ${robotId}`);
    }
  }

  /**
   * Check if robot is connected
   */
  isRobotConnected(robotId: string): boolean {
    return this.connections.get(robotId)?.isConnected || false;
  }

  /**
   * Publish cmd_vel to robot
   */
  publishCmdVel(robotId: string, linear: { x: number; y: number; z: number }, angular: { x: number; y: number; z: number }): void {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      this.logger.warn(`Robot ${robotId} is not connected`);
      return;
    }

    let cmdVelTopic = connection.topics.get('/cmd_vel');

    if (!cmdVelTopic) {
      cmdVelTopic = new ROSLIB.Topic({
        ros: connection.ros,
        name: '/cmd_vel',
        messageType: 'geometry_msgs/Twist',
      });
      connection.topics.set('/cmd_vel', cmdVelTopic);
    }

    const twist = new ROSLIB.Message({
      linear,
      angular,
    });

    cmdVelTopic.publish(twist);
    connection.lastSeen = new Date();
  }

  /**
   * Call mode service on robot
   */
  async callModeService(
    robotId: string,
    command: string,
    params?: any,
  ): Promise<any> {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      throw new Error(`Robot ${robotId} is not connected`);
    }

    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({
        ros: connection.ros,
        name: '/mode/req',
        serviceType: 'mode_manager/ModeRequest',
      });

      const requestData = JSON.stringify({
        command,
        ...params,
      });

      const request = new ROSLIB.ServiceRequest({
        request_data: requestData,
      });

      service.callService(
        request,
        (result: any) => {
          try {
            const response = JSON.parse(result.response_data);
            connection.lastSeen = new Date();
            resolve(response);
          } catch (error) {
            reject(error);
          }
        },
        (error: any) => {
          reject(error);
        },
      );
    });
  }

  /**
   * Call CurrentAngle service to get current arm joint angles
   */
  async getCurrentArmAngles(robotId: string): Promise<number[]> {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      throw new Error(`Robot ${robotId} is not connected`);
    }

    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({
        ros: connection.ros,
        name: '/CurrentAngle',
        serviceType: 'yahboomcar_msgs/RobotArmArray',
      });

      const request = new ROSLIB.ServiceRequest({
        apply: '',
      });

      service.callService(
        request,
        (result: any) => {
          try {
            const angles = result.angles || [];
            connection.lastSeen = new Date();
            this.logger.log(`Got current arm angles for robot ${robotId}: [${angles.join(', ')}]`);
            resolve(angles);
          } catch (error) {
            reject(error);
          }
        },
        (error: any) => {
          this.logger.error(`Failed to get current arm angles for robot ${robotId}:`, error);
          reject(error);
        },
      );
    });
  }

  /**
   * Subscribe to arm angle update topic
   */
  subscribeToArmAngleUpdate(robotId: string, callback?: (angles: number[]) => void): void {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      this.logger.warn(`Robot ${robotId} is not connected`);
      return;
    }

    // Check if already subscribed
    if (connection.topics.has('/ArmAngleUpdate')) {
      this.logger.log(`Already subscribed to /ArmAngleUpdate topic for robot ${robotId}`);
      return;
    }

    const armUpdateTopic = new ROSLIB.Topic({
      ros: connection.ros,
      name: '/ArmAngleUpdate',
      messageType: 'yahboomcar_msgs/ArmJoint',
    });

    armUpdateTopic.subscribe((message: any) => {
      // ArmJoint 메시지에서 joints 배열 추출
      const joints = message.joints || [];
      connection.lastSeen = new Date();

      this.logger.debug(`Robot ${robotId} arm update: [${joints.join(', ')}]`);

      if (callback && joints.length > 0) {
        callback(joints);
      }
    });

    connection.topics.set('/ArmAngleUpdate', armUpdateTopic);
    this.logger.log(`Subscribed to /ArmAngleUpdate topic for robot ${robotId}`);
  }

  /**
   * Subscribe to a topic on robot
   */
  subscribeToTopic(
    robotId: string,
    topicName: string,
    messageType: string,
    callback: (message: any) => void,
  ): void {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      this.logger.warn(`Robot ${robotId} is not connected`);
      return;
    }

    const topic = new ROSLIB.Topic({
      ros: connection.ros,
      name: topicName,
      messageType,
    });

    topic.subscribe((message) => {
      connection.lastSeen = new Date();
      callback(message);
    });

    connection.topics.set(topicName, topic);
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribeFromTopic(robotId: string, topicName: string): void {
    const connection = this.connections.get(robotId);
    if (connection) {
      const topic = connection.topics.get(topicName);
      if (topic) {
        topic.unsubscribe();
        connection.topics.delete(topicName);
      }
    }
  }

  /**
   * Get all connected robots
   */
  getConnectedRobots(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection status
   */
  getConnectionStatus(robotId: string): { isConnected: boolean; lastSeen?: Date; batteryVoltage?: number } {
    const connection = this.connections.get(robotId);
    return {
      isConnected: connection?.isConnected || false,
      lastSeen: connection?.lastSeen,
      batteryVoltage: connection?.batteryVoltage,
    };
  }

  /**
   * Subscribe to battery voltage topic
   */
  subscribeToBatteryVoltage(robotId: string, callback?: (voltage: number) => void): void {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      this.logger.warn(`Robot ${robotId} is not connected`);
      return;
    }

    // Check if already subscribed
    if (connection.topics.has('voltage')) {
      this.logger.log(`Already subscribed to voltage topic for robot ${robotId}`);
      return;
    }

    const voltageTopic = new ROSLIB.Topic({
      ros: connection.ros,
      name: '/voltage',
      messageType: 'std_msgs/Float32',
    });

    voltageTopic.subscribe((message: any) => {
      const voltage = message.data;
      connection.batteryVoltage = voltage;
      connection.lastSeen = new Date();

      // 로그 제거 - 너무 자주 발생
      // this.logger.debug(`Robot ${robotId} battery voltage: ${voltage}V`);

      if (callback) {
        callback(voltage);
      }
    });

    connection.topics.set('voltage', voltageTopic);
    this.logger.log(`Subscribed to voltage topic for robot ${robotId}`);
  }

  /**
   * Get battery voltage
   */
  getBatteryVoltage(robotId: string): number | undefined {
    const connection = this.connections.get(robotId);
    return connection?.batteryVoltage;
  }

  /**
   * Publish arm control command to /TargetAngle topic
   */
  publishArmControl(
    robotId: string,
    armCommand: {
      id: number;
      runTime: number;
      angle: number;
      joints: number[];
    },
  ): void {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      this.logger.warn(`Robot ${robotId} is not connected`);
      return;
    }

    let armTopic = connection.topics.get('/TargetAngle');

    if (!armTopic) {
      armTopic = new ROSLIB.Topic({
        ros: connection.ros,
        name: '/TargetAngle',
        messageType: 'yahboomcar_msgs/ArmJoint',
      });
      connection.topics.set('/TargetAngle', armTopic);
    }

    const message = new ROSLIB.Message({
      id: armCommand.id,
      run_time: armCommand.runTime,
      angle: armCommand.angle,
      joints: armCommand.joints,
    });

    armTopic.publish(message);
    connection.lastSeen = new Date();

    this.logger.log(
      `Published arm control for robot ${robotId}: id=${armCommand.id}, ` +
      `joints=[${armCommand.joints.join(', ')}], runTime=${armCommand.runTime}ms`,
    );
  }

  /**
   * Subscribe to laser scan topic
   */
  subscribeToLaserScan(robotId: string, callback?: (scanData: any) => void): void {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      this.logger.warn(`Robot ${robotId} is not connected`);
      return;
    }

    // Check if already subscribed
    if (connection.topics.has('/scan')) {
      this.logger.log(`Already subscribed to /scan topic for robot ${robotId}`);
      return;
    }

    const scanTopic = new ROSLIB.Topic({
      ros: connection.ros,
      name: '/scan',
      messageType: 'sensor_msgs/LaserScan',
    });

    scanTopic.subscribe((message: any) => {
      connection.lastSeen = new Date();

      // Relay scan data via callback
      if (callback) {
        callback(message);
      }
    });

    connection.topics.set('/scan', scanTopic);
    this.logger.log(`Subscribed to /scan topic for robot ${robotId}`);
  }

  /**
   * Unsubscribe from laser scan topic
   */
  unsubscribeFromLaserScan(robotId: string): void {
    this.unsubscribeFromTopic(robotId, '/scan');
    this.logger.log(`Unsubscribed from /scan topic for robot ${robotId}`);
  }

  /**
   * Subscribe to map topic
   */
  subscribeToMap(robotId: string, callback?: (mapData: any) => void): void {
    const connection = this.connections.get(robotId);
    if (!connection || !connection.isConnected) {
      this.logger.warn(`Robot ${robotId} is not connected`);
      return;
    }

    // Check if already subscribed
    if (connection.topics.has('/map')) {
      this.logger.log(`Already subscribed to /map topic for robot ${robotId}`);
      return;
    }

    const mapTopic = new ROSLIB.Topic({
      ros: connection.ros,
      name: '/map',
      messageType: 'nav_msgs/OccupancyGrid',
    });

    mapTopic.subscribe((message: any) => {
      connection.lastSeen = new Date();

      // Relay map data via callback
      if (callback) {
        callback(message);
      }
    });

    connection.topics.set('/map', mapTopic);
    this.logger.log(`Subscribed to /map topic for robot ${robotId}`);
  }

  /**
   * Unsubscribe from map topic
   */
  unsubscribeFromMap(robotId: string): void {
    this.unsubscribeFromTopic(robotId, '/map');
    this.logger.log(`Unsubscribed from /map topic for robot ${robotId}`);
  }

  /**
   * Get ROS instance for a robot
   */
  getRosInstance(robotId: string): ROSLIB.Ros | undefined {
    return this.connections.get(robotId)?.ros;
  }
}
