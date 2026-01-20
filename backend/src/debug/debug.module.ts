import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DebugStreamInterceptor } from './debug-stream.interceptor';
import { DebugStreamService } from './debug-stream.service';

@Module({
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
