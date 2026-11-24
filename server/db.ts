// Fachada de persistencia — reexporta nucleo, migracoes e consultas por entidade.

export * from './db-core.js';
export * from './db-shops.js';
export { SCHEMA, SCHEMA_MIGRATIONS, runSchemaMigrations } from './db-migrations.js';
