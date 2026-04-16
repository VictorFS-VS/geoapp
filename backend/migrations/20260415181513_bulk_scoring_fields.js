/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('formula_resultado', (table) => {
      table.boolean('cambio_detectado').defaultTo(false);
      table.timestamp('fecha_recalculo').nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('formula_resultado', (table) => {
      table.dropColumn('cambio_detectado');
      table.dropColumn('fecha_recalculo');
    });
};
