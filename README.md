# Robot Management Server
Nest.js 기반 로봇 제어·모니터링 백엔드. MongoDB에 로봇 메타데이터를 저장하고 JWT 인증으로 보호된 REST API를 제공합니다. React 프런트엔드(포트 3000/5173)와 연동됩니다.

## Stack
- Nest.js, TypeScript, Mongoose, class-validator
- JWT + Passport, bcrypt
- Axios 스트리밍(MJPEG 카메라 중계), ws(WebSocket) 기반 ROS 브리지 프록시

## Quick start
```bash
npm install
npm run start:dev   # http://localhost:3001
```
환경 변수: `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRATION`(기본 1h)

## 시스템 구성/데이터 파이프라인
- 클라이언트가 JWT로 `/robots` 계열 REST API 호출 → MongoDB에 저장된 로봇 메타데이터를 반환/갱신
- 제어·텔레메트리:
  - Socket.IO 게이트웨이(`robot-control.gateway.ts`)가 ROSBridge에 연결해 조이스틱/모드 서비스/암 각도/배터리 이벤트를 중계
  - ws 기반 프록시(`ros-proxy.service.ts`)가 프런트 ROSLIB 메시지를 로봇 ROSBridge에 투명하게 전달(OccupancyGrid 등 바이너리 포함)
- 영상:
  - `/robots/:id/camera`에서 Axios 스트리밍으로 web_video_server(MJPEG) 응답을 받아 그대로 파이프
- 상태/가용성:
  - `lastSeen`, `status`, `batteryVoltage`를 MongoDB에 업데이트하며, 헬스 체크(`/robots/:id/health`)는 최근 본 시간과 상태로 계산

## 인증/인가
- 로그인 `/api/auth/login` (`auth.controller.ts`)
  - `login.dto.ts`로 username/password 필수 검증
  - `auth.service.validateUser`가 bcrypt 비교 후 JWT payload 구성(username, nickname, sub, iat)
  - 응답: `accessToken`, `expiresIn`(`auth.service.ts`)
- 회원가입 `/api/auth/register`
  - `create-user.dto.ts`: username 길이 3~20, 비밀번호 대소문자·숫자·특수문자 포함(전체 매칭), nickname 길이 2~30
  - `users.service.ts`에서 bcrypt 해싱, 저장 후 `password_hash` 필드는 제거하고 반환
- 사용자명 중복 확인 `/api/auth/check-username`
- 로그아웃 `/api/auth/logout`: 클라이언트 토큰 삭제 전제로 200 응답
- JWT 전략: `jwt.strategy.ts`에서 Authorization: Bearer 토큰 검증, `JwtAuthGuard`로 보호된 엔드포인트

## 로봇 API 및 소유권 체크
- 목록/필터/온라인: `/robots`, `/robots/online` (JWT 필수)
- 단일 조회/수정/삭제/상태/헬스/카메라: `/robots/:id`, `.../status`, `.../health`, `.../camera`
  - 컨트롤러에서 `req.user.userId`를 서비스로 전달(`robots.controller.ts`)
  - 서비스가 `owner` 필터를 포함해 MongoDB 조회/갱신(`robots.service.ts`), 소유하지 않으면 404 반환
- 생성: `/robots`가 로그인 사용자 ID를 `owner`로 저장
- 카메라: `/robots/:id/camera?topic=...`이 Axios로 MJPEG 스트림을 가져와 헤더/바운더리를 그대로 전달

## ROS/제어 파이프라인
- WebSocket 프록시(`ros-proxy.service.ts`, 포트 3002): 클라이언트가 `?robotId=`로 접속 → 내부 `RobotConnectionService`에서 ROS 연결을 찾아 바이너리 포함 메시지를 양방향 전달 (현재 별도 인증 없음)
- Socket.IO 게이트웨이(`robot-control.gateway.ts`):
  - `robot:connect` 이벤트가 DB에서 로봇 정보를 조회 후 ROSBridge에 연결, 배터리/암각/레이저/맵 구독을 브로드캐스트
  - `RobotConnectionService`가 `/cmd_vel`, `/mode/req`, `/CurrentAngle`, `/ArmAngleUpdate`, 레이저/맵/배터리 토픽 등을 관리하며 `lastSeen`과 상태를 갱신

## 데이터 모델 (요약)
```typescript
Robot {
  id: string;
  name: string;
  type: string;
  ipAddress: string;
  port: number;
  status: 'online' | 'offline' | 'error';
  lastSeen: Date;
  capabilities: RobotCapability[];
  metadata: Record<string, any>;
  owner?: ObjectId;
  batteryVoltage?: number;
}
User {
  username: string; password_hash: string; nickname: string;
}
```

## Operational notes
- ROS WebSocket 프록시(3002)는 기본 인증이 없으니 내부망 한정 또는 JWT 검증 추가 필요
- 시드 로봇 데이터에 owner가 없으므로 멀티유저 환경에서는 비활성화/조정 권장

## Recommended next steps
- ROS 프록시 인증/인가 추가
- Refresh 토큰 및 블랙리스트
- 활동/감사 로그, 요청 속도 제한
- 로봇 공유 권한(RBAC) 및 텔레메트리 히스토리 저장
