import { describe, expect, it } from 'vitest';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { dataSourceOptions } from './data-source';

describe('data source conventions', () => {
  it('uses snake_case naming so camelCase props map to snake columns', () => {
    const s = dataSourceOptions.namingStrategy as SnakeNamingStrategy;
    expect(s).toBeInstanceOf(SnakeNamingStrategy);
    expect(s.columnName('updatedAt', undefined as any, [])).toBe('updated_at');
  });

  it('never auto-syncs schema — migrations are the only path', () => {
    expect(dataSourceOptions.synchronize).toBe(false);
    expect(dataSourceOptions.migrationsRun).toBe(true);
  });
});
