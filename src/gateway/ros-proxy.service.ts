// Rewritten RosProxyService with correct syntax and binary‑forwarding logic
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { RobotConnectionService } from '../robots/robot-connection.service';
import * as ROSLIB from 'roslib';

/**
 * Acts as a thin WebSocket bridge between the frontend ROSLIB client
 * and the ROS instance managed by RobotConnectionService.
 * It forwards messages bidirectionally without altering binary payloads,
 * ensuring OccupancyGrid (binary) messages are transmitted correctly.
 */
@Injectable()
export class RosProxyService implements OnModuleInit, OnModuleDestroy {
    private wss: WebSocketServer;
    private readonly logger = new Logger(RosProxyService.name);
    private readonly PORT = 3002;

    constructor(private readonly robotConnectionService: RobotConnectionService) { }

    onModuleInit() {
        this.wss = new WebSocketServer({ port: this.PORT });
        this.logger.log(`ROS Proxy Server started on port ${this.PORT}`);
        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            this.handleConnection(ws, req);
        });
    }

    onModuleDestroy() {
        if (this.wss) {
            this.wss.close();
        }
    }

    private handleConnection(ws: WebSocket, req: IncomingMessage) {
        let robotId: string | null = null;
        let robotSocket: any = null;
        let onRobotMessage: ((data: any) => void) | null = null;

        try {
            // ---- Parse robotId ---------------------------------------------------
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            robotId = url.searchParams.get('robotId');
            if (!robotId) {
                this.logger.warn('Client connected without robotId');
                ws.close(1008, 'robotId required');
                return;
            }

            this.logger.log(`Proxy connection attempt for robot ${robotId}`);

            // ---- Retrieve ROS instance ------------------------------------------
            const ros = this.robotConnectionService.getRosInstance(robotId);
            if (!ros) {
                this.logger.error(`Proxy Error: ROS instance not found for robot ${robotId}`);
                ws.close(1011, 'ROS instance not found');
                return;
            }
            if (!ros.isConnected) {
                this.logger.error(`Proxy Error: Robot ${robotId} is not connected to ROS`);
                ws.close(1011, 'Robot not connected to ROS');
                return;
            }

            // ---- Access underlying WebSocket from ROSLIB.Ros --------------------
            robotSocket = (ros as any).socket;
            if (!robotSocket) {
                this.logger.error(`Could not access robot socket for ${robotId}`);
                ws.close(1011, 'Internal Error');
                return;
            }

            this.logger.log(`Proxy connected to robot ${robotId} ROS instance`);

            // ---- Forward messages from client -> robot ---------------------------
            ws.on('message', (msg: any) => {
                if (robotSocket.readyState === WebSocket.OPEN) {
                    robotSocket.send(msg);
                }
            });

            // ---- Forward messages from robot -> client ---------------------------
            onRobotMessage = (data: any) => {
                if (ws.readyState === WebSocket.OPEN) {
                    // Send data unchanged (binary or text)
                    ws.send(data);
                }
            };

            // Register listener on robot socket
            if (typeof robotSocket.on === 'function') {
                robotSocket.on('message', onRobotMessage);
            } else if (typeof robotSocket.addEventListener === 'function') {
                robotSocket.addEventListener('message', (event: any) => onRobotMessage(event.data));
            } else {
                this.logger.warn('Unknown robot socket type, cannot forward messages from robot');
            }

            // ---- Cleanup on client disconnect / error ---------------------------
            ws.on('close', () => {
                this.logger.log(`Proxy client disconnected for robot ${robotId}`);
                this.cleanupListener(robotSocket, onRobotMessage);
            });
            ws.on('error', () => {
                this.logger.error(`Proxy client error for robot ${robotId}`);
                this.cleanupListener(robotSocket, onRobotMessage);
            });
        } catch (err) {
            this.logger.error('Error handling proxy connection:', err);
            ws.close(1011, 'Internal Error');
            if (robotSocket && onRobotMessage) {
                this.cleanupListener(robotSocket, onRobotMessage);
            }
        }
    }

    private cleanupListener(robotSocket: any, listener: ((data: any) => void) | null) {
        if (!robotSocket || !listener) return;
        try {
            if (typeof robotSocket.off === 'function') {
                robotSocket.off('message', listener);
            } else if (typeof robotSocket.removeEventListener === 'function') {
                robotSocket.removeEventListener('message', listener);
            }
        } catch (e) {
            // ignore cleanup errors
        }
    }
}
