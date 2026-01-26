import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DebugStreamController } from './debug-stream.controller';
import { DebugStreamInterceptor } from './debug-stream.interceptor';
import { DebugStreamService } from './debug-stream.service';

@Module({
  controllers: [DebugStreamController],
  providers: [
    DebugStreamService,
    {
      provide: APP_INTERCEPTOR,
      useClass: DebugStreamInterceptor,
    },
  ],
  exports: [DebugStreamService],
})
export class DebugModule {}
