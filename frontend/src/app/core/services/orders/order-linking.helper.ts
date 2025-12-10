import { OrderItem } from '../../models/order-item.model';

type UpdateItemFn = (itemId: string, updater: (item: OrderItem) => OrderItem) => void;

export class OrderLinkingHelper {
  constructor(private readonly updateItem: UpdateItemFn) {}

  linkBusinessToItem(businessId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      const ids = new Set(item.linkedBusinessIds ?? []);
      if (ids.has(businessId)) {
        return item;
      }
      ids.add(businessId);
      return { ...item, linkedBusinessIds: Array.from(ids) };
    });
  }

  unlinkBusinessFromItem(businessId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      const ids = new Set(item.linkedBusinessIds ?? []);
      if (!ids.has(businessId)) {
        return item;
      }
      ids.delete(businessId);
      const next = Array.from(ids);
      return {
        ...item,
        linkedBusinessIds: next.length ? next : undefined,
      };
    });
  }

  linkTemplateToItem(templateId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      if (item.linkedTemplateId === templateId) {
        return item;
      }
      return { ...item, linkedTemplateId: templateId };
    });
  }

  unlinkTemplateFromItem(templateId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      if (item.linkedTemplateId !== templateId) {
        return item;
      }
      const next = { ...item };
      delete next.linkedTemplateId;
      return next;
    });
  }
}
