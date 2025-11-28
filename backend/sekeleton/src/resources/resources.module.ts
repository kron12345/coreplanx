import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonnelEntity } from './entities/personnel.entity';
import { VehicleEntity } from './entities/vehicle.entity';
import { PersonnelServiceEntity } from './entities/personnel-service.entity';
import { VehicleServiceEntity } from './entities/vehicle-service.entity';
import { PersonnelPoolEntity } from './entities/personnel-pool.entity';
import { VehiclePoolEntity } from './entities/vehicle-pool.entity';
import { PersonnelServicePoolEntity } from './entities/personnel-service-pool.entity';
import { VehicleServicePoolEntity } from './entities/vehicle-service-pool.entity';
import { PersonnelPoolMemberEntity } from './entities/personnel-pool-member.entity';
import { VehiclePoolMemberEntity } from './entities/vehicle-pool-member.entity';
import { PersonnelServicePoolMemberEntity } from './entities/personnel-service-pool-member.entity';
import { VehicleServicePoolMemberEntity } from './entities/vehicle-service-pool-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PersonnelEntity,
      VehicleEntity,
      PersonnelServiceEntity,
      VehicleServiceEntity,
      PersonnelPoolEntity,
      VehiclePoolEntity,
      PersonnelServicePoolEntity,
      VehicleServicePoolEntity,
      PersonnelPoolMemberEntity,
      VehiclePoolMemberEntity,
      PersonnelServicePoolMemberEntity,
      VehicleServicePoolMemberEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class ResourcesModule {}
