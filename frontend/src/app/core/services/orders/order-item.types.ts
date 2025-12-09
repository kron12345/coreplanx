import { OrderItem } from '../../models/order-item.model';

export type EditableOrderItemKeys =
  | 'name'
  | 'start'
  | 'end'
  | 'responsible'
  | 'deviation'
  | 'serviceType'
  | 'fromLocation'
  | 'toLocation'
  | 'trafficPeriodId'
  | 'linkedBusinessIds'
  | 'linkedTemplateId'
  | 'linkedTrainPlanId'
  | 'tags';

export type OrderItemUpdateData = Pick<OrderItem, EditableOrderItemKeys>;
