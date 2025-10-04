import { Injectable, Logger } from '@nestjs/common';
import * as ROSLIB from 'roslib';

interface RobotConnection {
  ros: ROSLIB.Ros;
  topics: Map<string, ROSLIB.Topic>;
  isConnected: boolean;
  lastSeen: Date;
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
  async connectToRobot(robotId: string, rosUrl: string): Promise<boolean> {
    if (this.connections.has(robotId)) {
      this.logger.warn(`Robot ${robotId} is already connected`);
      return true;
    }

    return new Promise((resolve) => {
      const ros = new ROSLIB.Ros({ url: rosUrl });

      ros.on('connection', () => {
        this.logger.log(`Connected to robot ${robotId} at ${rosUrl}`);

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

        resolve(true);
      });

      ros.on('error', (error) => {
        this.logger.error(`Failed to connect to robot ${robotId}: ${error}`);

        // Notify callback
        const callback = this.connectionCallbacks.get(robotId);
        if (callback) callback('error');

        resolve(false);
      });

      ros.on('close', () => {
        this.logger.log(`Connection to robot ${robotId} closed`);

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

    let cmdVelTopic = connection.topics.get('web/cmd_vel');

    if (!cmdVelTopic) {
      cmdVelTopic = new ROSLIB.Topic({
        ros: connection.ros,
        name: 'web/cmd_vel',
        messageType: 'geometry_msgs/Twist',
      });
      connection.topics.set('web/cmd_vel', cmdVelTopic);
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
  getConnectionStatus(robotId: string): { isConnected: boolean; lastSeen?: Date } {
    const connection = this.connections.get(robotId);
    return {
      isConnected: connection?.isConnected || false,
      lastSeen: connection?.lastSeen,
    };
  }
}
