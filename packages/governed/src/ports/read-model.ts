import type { NamespaceId } from '../domain/ids.js';

/** The live, queryable projection a RebuildCoordinator checks its rebuilt digest against. */
export interface ReadModel {
  digest(namespace: NamespaceId): Promise<string>;
}
