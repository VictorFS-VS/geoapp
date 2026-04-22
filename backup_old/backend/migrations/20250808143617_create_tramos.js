/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Asegura el schema 'ema'
  await knex.raw('CREATE SCHEMA IF NOT EXISTS ema');

  // Crea la tabla tramos si aún no existe
  const exists = await knex.schema.withSchema('ema').hasTable('tramos');
  if (!exists) {
    await knex.schema.withSchema('ema').createTable('tramos', table => {
      table.increments('id_tramo').primary();
      table.string('nombre_tramo').notNullable().unique();
      table.integer('id_proyecto').notNullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Elimina la tabla tramos si existe
  const exists = await knex.schema.withSchema('ema').hasTable('tramos');
  if (exists) {
    await knex.schema.withSchema('ema').dropTable('tramos');
  }
};
