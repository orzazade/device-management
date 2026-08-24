export interface RequestRow {
  id: string;
  device: {
    id: string;
    brand?: string;
    model?: string;
    holder?: { id: string; name: string } | null;
    accessories?: string[];
    damageNote?: string | null;
  };
  requester: { id: string; name?: string };
  createdById: string;
  reason: string;
  fromDate: string;
  toDate: string;
  state: string;
  decisionNote?: string | null;
  createdAt: string;
}
