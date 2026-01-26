import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrafficPeriodsController } from './traffic-periods.controller';
import { TrafficPeriodsService } from './traffic-periods.service';

@Module({
  imports: [PrismaModule],
  controllers: [TrafficPeriodsController],
  providers: [TrafficPeriodsService],
  exports: [TrafficPeriodsService],
})
export class TrafficPeriodsModule {}
