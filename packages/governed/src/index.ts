export const GOVERNED_PACKAGE_NAME = '@algerknown/governed';

export * from './domain/index.js';
export * from './config/index.js';
export * from './ports/index.js';
export * from './write/index.js';
export * from './rails/index.js';
export * from './read-models/reference.js';

// Note: adapters/algerknown is deliberately NOT re-exported here. It is the
// one part of this package allowed to depend on @algerknown/core (see
// tests/boundary/package-boundary.test.ts), and re-exporting it from this
// root barrel would make that dependency transitive for every consumer of
// "@algerknown/governed". Import it explicitly via the
// "@algerknown/governed/adapters/algerknown" subpath instead.
