/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('informe_pregunta', (table) => {
      table.boolean('visible_en_listado').defaultTo(false).nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('informe_pregunta', (table) => {
      table.dropColumn('visible_en_listado');
    });
};
