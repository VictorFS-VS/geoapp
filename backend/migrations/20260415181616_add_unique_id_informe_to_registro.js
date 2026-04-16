/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('informe_registro', (table) => {
      table.unique(['id_informe']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('informe_registro', (table) => {
      table.dropUnique(['id_informe']);
    });
};
