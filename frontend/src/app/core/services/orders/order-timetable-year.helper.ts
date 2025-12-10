import { Order } from '../../models/order.model';
import { OrderItem } from '../../models/order-item.model';
import { TrafficPeriodService } from '../traffic-period.service';
import { TimetableYearService } from '../timetable-year.service';

type OrdersProvider = () => Order[];

export class OrderTimetableYearHelper {
  constructor(
    private readonly trafficPeriodService: TrafficPeriodService,
    private readonly timetableYearService: TimetableYearService,
    private readonly ordersProvider: OrdersProvider,
  ) {}

  getItemTimetableYear(item: OrderItem): string | null {
    if (item.timetableYearLabel) {
      return item.timetableYearLabel;
    }
    if (item.trafficPeriodId) {
      const period = this.trafficPeriodService.getById(item.trafficPeriodId);
      if (period?.timetableYearLabel) {
        return period.timetableYearLabel;
      }
      const sampleDate =
        period?.rules?.find((rule) => rule.includesDates?.length)?.includesDates?.[0] ??
        period?.rules?.[0]?.validityStart;
      if (sampleDate) {
        try {
          return this.timetableYearService.getYearBounds(sampleDate).label;
        } catch {
          return null;
        }
      }
    }
    const sampleDate = item.validity?.[0]?.startDate ?? item.start ?? item.end ?? null;
    if (!sampleDate) {
      return null;
    }
    try {
      return this.timetableYearService.getYearBounds(sampleDate).label;
    } catch {
      return null;
    }
  }

  timetableYearOptions(): string[] {
    const labels = new Map<string, number>();
    this.timetableYearService.managedYearBounds().forEach((year) => {
      labels.set(year.label, year.startYear);
    });
    this.ordersProvider().forEach((order) =>
      order.items.forEach((item) => {
        const label = this.getItemTimetableYear(item);
        if (label && !labels.has(label)) {
          const bounds = this.timetableYearService.getYearByLabel(label);
          labels.set(label, bounds.startYear);
        }
      }),
    );
    return Array.from(labels.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([label]) => label);
  }
}
