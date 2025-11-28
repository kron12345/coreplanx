import { OrderItem } from './order-item.model';

export type OrderProcessStatus =
  | 'auftrag'
  | 'planung'
  | 'produkt_leistung'
  | 'produktion'
  | 'abrechnung_nachbereitung';

export interface Order {
  id: string;
  name: string;
  customerId?: string;
  customer?: string;
  tags?: string[];
  items: OrderItem[];
  comment?: string;
  timetableYearLabel?: string;
   /**
    * SOB-interner Prozessstatus des Auftrags (optional im Mock).
    * Dient der Einordnung in Auftrag → Planung → Produkt/Leistung → Produktion → Abrechnung/Nachbereitung.
    */
  processStatus?: OrderProcessStatus;
}
