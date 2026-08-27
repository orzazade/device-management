export type DeviceStatus = 'available' | 'assigned' | 'in_repair' | 'retired';

export interface DeviceRow {
  id: string;
  brand: string;
  model: string;
  os: string;
  osVersion: string;
  specs: Record<string, unknown>;
  serial: string;
  imei: string;
  status: DeviceStatus;
  damageNote: string | null;
  accessories: string[];
  holder: { id: string; name: string } | null;
  busy?: { until: string; state: 'active' | 'overdue' } | null;
  project: { id: string; name: string } | null;
  squad: { id: string; name: string } | null;
  createdAt: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  kind: 'project' | 'squad';
  deviceCount: number;
}

export interface AuditRow {
  id: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: string;
  entityLabel?: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}
