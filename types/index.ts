export type Lang = "ru" | "uk";
export type PaymentType = "КАРТА" | "НАЛИЧНЫЕ";
export type ViewMode = "add" | "list" | "base";

export interface ClientRecord {
  id: string;
  name: string;
  phone: string;
  addr: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface OrderRecord {
  id: string;
  name: string;
  phone: string;
  addr: string;
  sum: string;
  pay: PaymentType;
  note: string;
  done: boolean;
  isOld?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ParsedOrderDraft extends OrderRecord {}

export interface AppSnapshot {
  orders: OrderRecord[];
  clients: ClientRecord[];
}
